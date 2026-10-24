"""Apply an editor session (text replacement, new text, images, white-out, page order) to a PDF.

All bboxes arrive in *display space* of the original page (see docs/API.md). PyMuPDF's
drawing / annotation APIs work in the unrotated page space, so every rect is converted with
``rect * page.derotation_matrix`` (display -> unrotated); text and images are inserted with
``rotate=page.rotation`` so they appear upright on screen.
"""
from __future__ import annotations

import base64
import binascii
import io
import math
import os
from functools import lru_cache

import pymupdf
from PIL import Image

from .common import (
    MUPDF_LOCK,
    UserError,
    check_output_path,
    check_page_index,
    file_name,
    grow_limit,
    growth_obstacles,
    hex_to_rgb,
    open_pdf,
    pdf_bytes,
    write_bytes_safely,
)

EDIT_TYPES = ("replace_text", "add_text", "image", "whiteout")
MIN_FONT_SIZE = 4.0

_FAMILIES = {
    "helv": ("helv", "hebo", "heit", "hebi"),
    "tiro": ("tiro", "tibo", "tiit", "tibi"),
    "cour": ("cour", "cobo", "coit", "cobi"),
}

# System fonts tried (in order) when the Base-14 font lacks a glyph the user typed.
_FALLBACK_FONT_FILES = [
    r"C:/Windows/Fonts/arial.ttf",
    r"C:/Windows/Fonts/segoeui.ttf",
    r"C:/Windows/Fonts/seguisym.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def base14_code(serif=False, mono=False, bold=False, italic=False) -> str:
    family = "cour" if mono else ("tiro" if serif else "helv")
    return _FAMILIES[family][(1 if bold else 0) + (2 if italic else 0)]


@lru_cache(maxsize=32)
def _font(code: str) -> pymupdf.Font:
    return pymupdf.Font(code)


@lru_cache(maxsize=16)
def _font_file(path: str) -> pymupdf.Font | None:
    try:
        return pymupdf.Font(fontfile=path)
    except Exception:
        return None


def _missing_glyphs(font: pymupdf.Font, text: str) -> bool:
    return any(not ch.isspace() and not font.has_glyph(ord(ch)) for ch in set(text))


class FontRegistry:
    """Embeds the fonts we write with into each page (once per page and font)."""

    def __init__(self):
        self._done: set[tuple[int, str]] = set()

    def font_for(self, page: pymupdf.Page, code: str, text: str) -> tuple[str, pymupdf.Font]:
        font = _font(code)
        name, source = f"CatPDF-{code}", ("buffer", code)
        if _missing_glyphs(font, text):
            for i, path in enumerate(_FALLBACK_FONT_FILES):
                if os.path.isfile(path):
                    fb = _font_file(path)
                    if fb is not None and not _missing_glyphs(fb, text):
                        font, name, source = fb, f"CatPDF-fb{i}", ("file", path)
                        break
        key = (page.number, name)
        if key not in self._done:
            if source[0] == "buffer":
                page.insert_font(fontname=name, fontbuffer=font.buffer)
            else:
                page.insert_font(fontname=name, fontfile=source[1])
            self._done.add(key)
        return name, font


# --------------------------------------------------------------------------- geometry

def _display_rect(bbox) -> pymupdf.Rect:
    try:
        vals = [float(v) for v in bbox]
    except (TypeError, ValueError):
        raise UserError("An edit has an invalid box.")
    if len(vals) != 4 or not all(math.isfinite(v) for v in vals):
        raise UserError("An edit has an invalid box.")
    r = pymupdf.Rect(*vals)
    r.normalize()
    return r


def _to_unrotated(page: pymupdf.Page, disp: pymupdf.Rect) -> pymupdf.Rect:
    r = pymupdf.Rect(disp) * page.derotation_matrix
    r.normalize()
    return r


# --------------------------------------------------------------------------- text removal

def _redaction_rects(page: pymupdf.Page, disp: pymupdf.Rect,
                     raw: dict) -> tuple[list[pymupdf.Rect], int]:
    """Rects (unrotated space) that redact exactly the characters whose centre is in *disp*.

    MuPDF removes every character whose box merely *touches* a redaction rect, and line
    boxes of tightly set text overlap, so redacting the raw span bbox would also eat parts
    of the lines above and below. Instead we select characters by their centre and redact a
    thin band through the middle of each selected run.

    Also returns the on-screen direction of the removed text (0/90/180/270 degrees
    clockwise, 0 = normal left-to-right) so the replacement can be written the same way.
    """
    target = _to_unrotated(page, disp) + (-1, -1, 1, 1)
    rects: list[pymupdf.Rect] = []
    votes: dict[int, int] = {}
    m = page.rotation_matrix
    for block in raw.get("blocks", []):
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1, 0))
            horizontal = abs(dx) >= abs(dy)
            vx, vy = dx * m.a + dy * m.c, dx * m.b + dy * m.d
            angle = int(round(math.degrees(math.atan2(vy, vx)) / 90.0)) * 90 % 360
            run: pymupdf.Rect | None = None
            for span in line.get("spans", []):
                for ch in span.get("chars", []):
                    cb = pymupdf.Rect(ch["bbox"])
                    centre = pymupdf.Point((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2)
                    if target.contains(centre) and not cb.is_empty:
                        run = cb if run is None else run | cb
                        if ch.get("c", " ").strip():
                            votes[angle] = votes.get(angle, 0) + 1
                    elif run is not None:
                        rects.append(_band(run, horizontal))
                        run = None
            if run is not None:
                rects.append(_band(run, horizontal))
    angle = max(votes, key=votes.get) if votes else 0
    return rects, angle


def _band(r: pymupdf.Rect, horizontal: bool) -> pymupdf.Rect:
    if horizontal:
        cy, h = (r.y0 + r.y1) / 2, max(r.height * 0.2, 0.5)
        inset = min(0.4, r.width / 4)
        return pymupdf.Rect(r.x0 + inset, cy - h, r.x1 - inset, cy + h)
    cx, w = (r.x0 + r.x1) / 2, max(r.width * 0.2, 0.5)
    inset = min(0.4, r.height / 4)
    return pymupdf.Rect(cx - w, r.y0 + inset, cx + w, r.y1 - inset)


# --------------------------------------------------------------------------- text writing

LINE_HEIGHT = 1.2  # line advance, in font sizes


def _wrap(font: pymupdf.Font, text: str, size: float, width: float,
          break_words: bool, wrap: bool = True) -> tuple[list[str], bool]:
    """Greedy word wrap. Returns (lines, ok); ok is False if a word is wider than *width*.

    With ``wrap=False`` only explicit newlines break lines (ok = every line fits).
    """
    if not wrap and not break_words:
        lines = text.split("\n")
        return lines, all(font.text_length(l, fontsize=size) <= width + 0.01 for l in lines)
    lines: list[str] = []
    ok = True
    for para in text.split("\n"):
        words = para.split(" ")
        current = ""
        for word in words:
            candidate = f"{current} {word}" if current else word
            if font.text_length(candidate, fontsize=size) <= width + 0.01 or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
            if font.text_length(current, fontsize=size) > width + 0.01:
                if not break_words:
                    ok = False
                else:  # split the over-long word character by character
                    piece = ""
                    for ch in current:
                        if piece and font.text_length(piece + ch, fontsize=size) > width + 0.01:
                            lines.append(piece)
                            piece = ch
                        else:
                            piece += ch
                    current = piece
        lines.append(current)
    return lines, ok


# Text frame for each on-screen direction: (origin corner, u = along the text, v = line advance)
_FRAMES = {
    0: (lambda r: (r.x0, r.y0), (1, 0), (0, 1)),
    90: (lambda r: (r.x1, r.y0), (0, 1), (-1, 0)),
    180: (lambda r: (r.x1, r.y1), (-1, 0), (0, -1)),
    270: (lambda r: (r.x0, r.y1), (0, -1), (1, 0)),
}


def write_text_fitting(page: pymupdf.Page, fonts: FontRegistry, disp: pymupdf.Rect, text: str,
                       size: float | None, color: str | None, serif=False, mono=False,
                       bold=False, italic=False, single_line_box: bool = False,
                       angle: int = 0) -> float:
    """Write *text* inside *disp* (display space), shrinking the font (min 4 pt) until it fits.

    *angle* is the on-screen text direction (clockwise degrees, 0 = normal). Layout is
    computed in a text frame laid over the display box and every line is drawn with
    ``insert_text(..., rotate=(page.rotation - angle) % 360)``, which makes it read in that
    direction on screen whatever the page's /Rotate is. Returns the font size used. Text is
    never dropped: if it doesn't fit even at 4 pt, it continues below the box.
    """
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    if not text.strip():
        return 0.0
    angle = int(angle or 0) % 360
    if angle not in _FRAMES:
        angle = 0
    code = base14_code(serif, mono, bold, italic)
    fontname, font = fonts.font_for(page, code, text)
    rgb = hex_to_rgb(color)
    try:
        size = float(size) if size else 11.0
    except (TypeError, ValueError):
        size = 11.0
    size = max(MIN_FONT_SIZE, min(size, 500.0))
    rect = pymupdf.Rect(disp)
    origin_of, (ux, uy), (vx, vy) = _FRAMES[angle]
    ox, oy = origin_of(rect)
    width, height = (rect.width, rect.height) if angle in (0, 180) else (rect.height, rect.width)
    width = max(width, 1.0)

    def needed_height(n: int, s: float) -> float:
        return s * (1 + (n - 1) * LINE_HEIGHT)

    # A replaced single line stays a single line (shrinks instead of wrapping).
    wrap = not (single_line_box and height < size * 2.2)
    while True:
        lines, ok = _wrap(font, text, size, width, break_words=False, wrap=wrap)
        if ok and needed_height(len(lines), size) <= height + 1:
            break
        if size <= MIN_FONT_SIZE:
            lines, _ = _wrap(font, text, size, width, break_words=True)
            break
        size = max(MIN_FONT_SIZE, round(size * 0.92, 2))

    asc = font.ascender if font.ascender > 0 else 0.9
    desc = -font.descender if font.descender < 0 else 0.25
    block_h = size * (asc + desc) + (len(lines) - 1) * size * LINE_HEIGHT
    if block_h <= height or len(lines) > 1 and needed_height(len(lines), size) > height + 1:
        v = asc * size  # top aligned (also when the text had to run past the box)
    else:  # centre on the box (keeps a replaced line on its original baseline)
        v = height / 2 - block_h / 2 + asc * size
    derot = page.derotation_matrix
    rotate = (page.rotation - angle) % 360
    for line in lines:
        if line.strip():
            pt = pymupdf.Point(ox + v * vx, oy + v * vy) * derot
            page.insert_text(pt, line, fontname=fontname, fontsize=size, color=rgb, rotate=rotate)
        v += size * LINE_HEIGHT
    return size


# --------------------------------------------------------------------------- images

def decode_data_url(data: str) -> bytes:
    if not data or not isinstance(data, str):
        raise UserError("An image edit has no image data.")
    payload = data.split(",", 1)[1] if data.strip().lower().startswith("data:") else data
    try:
        raw = base64.b64decode(payload.strip(), validate=False)
    except (binascii.Error, ValueError):
        raise UserError("An image edit has invalid image data.")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise UserError("An image edit doesn't contain a valid PNG or JPEG image.")
    if (img.format or "").upper() in ("PNG", "JPEG"):
        return raw
    out = io.BytesIO()
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    img.convert("RGBA" if has_alpha else "RGB").save(out, "PNG")
    return out.getvalue()


# --------------------------------------------------------------------------- main entry

def _validate_edits(doc: pymupdf.Document, edits: list[dict], path: str) -> dict[int, list[dict]]:
    per_page: dict[int, list[dict]] = {}
    for e in edits or []:
        etype = (e.get("type") or "").strip()
        if etype not in EDIT_TYPES:
            raise UserError(f'Unknown edit type "{etype}".')
        idx = check_page_index(doc, e.get("page", 0), path)
        rect = _display_rect(e.get("bbox"))
        if rect.is_empty or rect.width < 0.5 or rect.height < 0.5:
            if etype in ("image", "whiteout"):
                raise UserError("An edit box is too small.")
        per_page.setdefault(idx, []).append({**e, "type": etype, "_rect": rect})
    return per_page


def _apply_page_edits(page: pymupdf.Page, edits: list[dict], fonts: FontRegistry) -> None:
    # 1) Remove the original text under every replace_text box (batched per page).
    replaces = [e for e in edits if e["type"] == "replace_text"]
    if replaces:
        raw = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE
                            | pymupdf.TEXT_PRESERVE_LIGATURES | pymupdf.TEXT_MEDIABOX_CLIP)
        count = 0
        for e in replaces:
            rects, e["_angle"] = _redaction_rects(page, e["_rect"], raw)
            for r in rects:
                page.add_redact_annot(r, fill=False, cross_out=False)
                count += 1
        if count:
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                                  graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    # 2) Draw everything in the order the user made the edits. Replaced lines may grow to the
    #    right into free space; the other replaced boxes count as taken.
    obstacles = []
    if replaces:
        obstacles = growth_obstacles(page) + [tuple(e["_rect"]) for e in replaces]
    for e in edits:
        rect = e["_rect"]
        t = e["type"]
        if t == "replace_text" and e.get("_angle", 0) == 0:
            rect = pymupdf.Rect(rect.x0, rect.y0, grow_limit(page.rect.width, rect, obstacles), rect.y1)
        if t in ("replace_text", "add_text"):
            write_text_fitting(page, fonts, rect, e.get("text") or "", e.get("size"),
                               e.get("color"), bool(e.get("serif")), bool(e.get("mono")),
                               bool(e.get("bold")), bool(e.get("italic")),
                               single_line_box=(t == "replace_text"), angle=e.get("_angle", 0))
        elif t == "image":
            data = decode_data_url(e.get("data"))
            page.insert_image(_to_unrotated(page, rect), stream=data, keep_proportion=True,
                              rotate=page.rotation, overlay=True)
        elif t == "whiteout":
            page.draw_rect(_to_unrotated(page, rect), color=None, fill=(1, 1, 1),
                           width=0, overlay=True)


def _norm_rotate(value) -> int:
    try:
        r = int(value or 0)
    except (TypeError, ValueError):
        raise UserError("Page rotation must be 0, 90, 180 or 270.")
    if r % 90:
        raise UserError("Page rotation must be 0, 90, 180 or 270.")
    return r % 360


_META_KEYS = ("title", "author", "subject", "keywords", "creator", "producer",
              "creationDate", "modDate")


def apply_edits(path: str, output: str, pages: list[dict] | None = None,
                edits: list[dict] | None = None) -> dict:
    check_output_path(output)
    with MUPDF_LOCK:
        src = open_pdf(path)
        others: dict[str, pymupdf.Document] = {}
        result = None
        try:
            n = src.page_count
            per_page = _validate_edits(src, edits or [], path)

            # Validate the final page order before doing any work.
            plan: list[tuple[pymupdf.Document, int, int, bool]] = []
            if pages is None:
                plan = [(src, i, 0, True) for i in range(n)]
            else:
                if len(pages) == 0:
                    raise UserError("The edited document would have no pages.")
                for entry in pages:
                    rot = _norm_rotate(entry.get("rotate", 0))
                    other = entry.get("file")
                    if other:
                        key = os.path.normcase(os.path.abspath(other))
                        if key not in others:
                            others[key] = open_pdf(other)
                        odoc = others[key]
                        idx = check_page_index(odoc, entry.get("src", 0), other)
                        plan.append((odoc, idx, rot, False))
                    else:
                        idx = check_page_index(src, entry.get("src", 0), path)
                        plan.append((src, idx, rot, True))

            fonts = FontRegistry()
            for idx in sorted(per_page):
                _apply_page_edits(src[idx], per_page[idx], fonts)

            identity = (len(plan) == n and all(d is src and i == k for k, (d, i, _, _) in enumerate(plan)))
            if identity:
                # Keep the original document (bookmarks, forms, links...) and only rotate.
                for k, (_, _, rot, _) in enumerate(plan):
                    if rot:
                        pg = src[k]
                        pg.set_rotation((pg.rotation + rot) % 360)
                result = src
            else:
                out = pymupdf.open()
                for d, i, rot, _ in plan:
                    out.insert_pdf(d, from_page=i, to_page=i)
                    pg = out[out.page_count - 1]
                    if rot:
                        pg.set_rotation((pg.rotation + rot) % 360)
                meta = {k: v for k, v in (src.metadata or {}).items() if k in _META_KEYS and v}
                if meta:
                    try:
                        out.set_metadata(meta)
                    except Exception:
                        pass
                result = out
            page_count = result.page_count
            data = pdf_bytes(result)
        finally:
            if result is not None and result is not src:
                result.close()
            src.close()
            for d in others.values():
                d.close()
    write_bytes_safely(output, data)
    return {"output": output, "pages": page_count}
