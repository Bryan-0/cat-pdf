"""Read-only page operations: document info, page rendering (cached) and text spans."""
from __future__ import annotations

import os
import re
import threading
from collections import OrderedDict

import pymupdf

from .common import (
    MUPDF_LOCK,
    UserError,
    check_input_file,
    check_page_index,
    file_name,
    int_to_hex,
    opened_pdf,
)

RENDER_MIN_WIDTH = 50
RENDER_MAX_WIDTH = 2400
RENDER_CACHE_MAX = 300


# --------------------------------------------------------------------------- info

def pdf_info(path: str) -> dict:
    p = check_input_file(path, "PDF")
    with MUPDF_LOCK, opened_pdf(p) as doc:
        meta = doc.metadata or {}
        sizes = []
        for page in doc:
            r = page.rect  # display space (rotation applied)
            sizes.append([round(r.width, 2), round(r.height, 2)])
        return {
            "path": path,
            "name": file_name(path),
            "pages": doc.page_count,
            "title": (meta.get("title") or "").strip(),
            "author": (meta.get("author") or "").strip(),
            "encrypted": bool(doc.is_encrypted),
            "size_bytes": os.path.getsize(p),
            "page_sizes": sizes,
        }


# --------------------------------------------------------------------------- render

class RenderCache:
    """Tiny thread-safe LRU cache of rendered PNG bytes."""

    def __init__(self, max_entries: int = RENDER_CACHE_MAX):
        self.max_entries = max_entries
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            value = self._data.get(key)
            if value is not None:
                self._data.move_to_end(key)
            return value

    def put(self, key, value) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        return len(self._data)


RENDER_CACHE = RenderCache()


def clamp_width(width) -> int:
    try:
        w = int(float(width))
    except (TypeError, ValueError):
        w = 300
    return max(RENDER_MIN_WIDTH, min(RENDER_MAX_WIDTH, w))


def render_page(path: str, page: int = 0, width: int = 300) -> bytes:
    """Render a page to PNG so that the image is *width* pixels wide (display orientation)."""
    p = check_input_file(path, "PDF")
    width = clamp_width(width)
    st = os.stat(p)
    key = (os.path.normcase(os.path.abspath(p)), st.st_mtime_ns, st.st_size, int(page), width)
    cached = RENDER_CACHE.get(key)
    if cached is not None:
        return cached
    with MUPDF_LOCK, opened_pdf(p) as doc:
        idx = check_page_index(doc, page, path)
        pg = doc[idx]
        zoom = width / max(pg.rect.width, 1.0)
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, annots=True)
        png = pix.tobytes("png")
    RENDER_CACHE.put(key, png)
    return png


# --------------------------------------------------------------------------- text

_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")


def font_traits(font: str, flags: int) -> dict:
    """Guess bold/italic/serif/mono from the font name, falling back to MuPDF's flags."""
    name = _SUBSET_PREFIX.sub("", font or "")
    low = name.lower()
    bold = bool(flags & 16) or any(k in low for k in ("bold", "black", "heavy", "semibold", "demi"))
    italic = bool(flags & 2) or any(k in low for k in ("italic", "oblique"))
    mono = bool(flags & 8) or any(
        k in low for k in ("courier", "mono", "consolas", "menlo", "typewriter", "code")
    )
    if any(k in low for k in ("sans", "helvetica", "arial", "verdana", "calibri", "segoe",
                               "tahoma", "roboto", "inter", "open", "lato", "aptos")):
        serif = False
    elif any(k in low for k in ("times", "serif", "roman", "georgia", "garamond", "cambria",
                                 "palatino", "book", "minion", "tiro", "charter")):
        serif = True
    else:
        serif = bool(flags & 4)
    if mono:
        serif = False
    return {"font": name, "bold": bold, "italic": italic, "serif": serif, "mono": mono}


def page_text_spans(path: str, page: int = 0) -> dict:
    """Text spans of a page with bboxes in display space (see docs/API.md)."""
    with MUPDF_LOCK, opened_pdf(path) as doc:
        idx = check_page_index(doc, page, path)
        pg = doc[idx]
        rot = pg.rotation_matrix  # unrotated -> display
        data = pg.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
        spans = []
        for b_no, block in enumerate(data.get("blocks", [])):
            if block.get("type", 0) != 0:
                continue
            for l_no, line in enumerate(block.get("lines", [])):
                for s_no, span in enumerate(line.get("spans", [])):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    r = pymupdf.Rect(span["bbox"]) * rot
                    r.normalize()
                    traits = font_traits(span.get("font", ""), int(span.get("flags", 0)))
                    spans.append({
                        "id": f"{idx}-{b_no}-{l_no}-{s_no}",
                        "text": text,
                        "bbox": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
                        "size": round(float(span.get("size", 11.0)), 2),
                        "font": traits["font"],
                        "color": int_to_hex(span.get("color", 0)),
                        "bold": traits["bold"],
                        "italic": traits["italic"],
                        "serif": traits["serif"],
                        "mono": traits["mono"],
                    })
        return {
            "width": round(pg.rect.width, 2),
            "height": round(pg.rect.height, 2),
            "spans": spans,
        }


__all__ = ["pdf_info", "render_page", "page_text_spans", "RENDER_CACHE", "font_traits", "UserError"]
