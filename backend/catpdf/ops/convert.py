"""Conversions: images -> PDF and DOCX -> PDF (Word / LibreOffice / built-in engines)."""
from __future__ import annotations

import base64
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.etree import ElementTree as ET

import pymupdf
from PIL import Image, ImageOps

from .common import (
    DOCX_EXTS,
    IMAGE_EXTS,
    MUPDF_LOCK,
    UserError,
    check_input_file,
    check_output_path,
    ext_of,
    file_name,
    pdf_bytes,
    write_bytes_safely,
)

Image.MAX_IMAGE_PIXELS = 400_000_000  # allow big scans, still guard against bombs

PAGE_SIZES = {"a4": (595.28, 841.89), "letter": (612.0, 792.0)}


# =========================================================================== images

class PreparedImage:
    """Image bytes ready for PyMuPDF plus their upright pixel size and DPI."""

    def __init__(self, data: bytes, width: int, height: int, dpi: float):
        self.data = data
        self.width = width
        self.height = height
        self.dpi = dpi

    @property
    def size_pt(self) -> tuple[float, float]:
        return self.width * 72.0 / self.dpi, self.height * 72.0 / self.dpi


def prepare_image(path: str) -> PreparedImage:
    """Load an image file, honour EXIF orientation and normalise odd modes.

    JPEGs that need no rotation are passed through untouched (no quality loss).
    Transparency (RGBA / LA / palette with transparency) is preserved via PNG.
    """
    p = check_input_file(path, "image")
    try:
        with open(p, "rb") as f:
            raw = f.read()
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise UserError(f"{file_name(path)} could not be read as an image.")
    fmt = (img.format or "").upper()
    dpi = 96.0
    try:
        d = img.info.get("dpi")
        if d and float(d[0]) >= 30:
            dpi = float(d[0])
    except Exception:
        pass
    try:
        orientation = img.getexif().get(0x0112, 1)
    except Exception:
        orientation = 1
    if fmt == "JPEG" and orientation in (1, None) and img.mode in ("RGB", "L", "CMYK"):
        return PreparedImage(raw, img.width, img.height, dpi)

    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (
        img.mode == "P" and "transparency" in img.info
    )
    out = io.BytesIO()
    if has_alpha:
        img = img.convert("RGBA")
        img.save(out, "PNG")
    elif fmt == "JPEG":
        img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        img.save(out, "JPEG", quality=95)
    else:
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(out, "PNG")
    return PreparedImage(out.getvalue(), img.width, img.height, dpi)


def _target_page_size(img: PreparedImage, page_size: str, orientation: str) -> tuple[float, float]:
    if page_size == "fit":
        return img.size_pt
    w, h = PAGE_SIZES[page_size]
    if orientation == "landscape" or (orientation == "auto" and img.width > img.height):
        w, h = max(w, h), min(w, h)
    else:
        w, h = min(w, h), max(w, h)
    return w, h


def add_image_page(doc: pymupdf.Document, path: str, page_size: str = "fit",
                   orientation: str = "auto", margin: float = 0.0) -> None:
    """Append one page containing the image at *path* (scaled to fit, centred)."""
    img = prepare_image(path)
    pw, ph = _target_page_size(img, page_size, orientation)
    m = max(0.0, float(margin or 0))
    if page_size != "fit" and m * 2 >= min(pw, ph) - 10:
        raise UserError("The margin is too big for the page size.")
    page = doc.new_page(width=pw + (2 * m if page_size == "fit" else 0),
                        height=ph + (2 * m if page_size == "fit" else 0))
    box = page.rect + (m, m, -m, -m)
    iw, ih = img.size_pt
    scale = min(box.width / iw, box.height / ih)
    w, h = iw * scale, ih * scale
    x0 = box.x0 + (box.width - w) / 2
    y0 = box.y0 + (box.height - h) / 2
    try:
        page.insert_image(pymupdf.Rect(x0, y0, x0 + w, y0 + h), stream=img.data, keep_proportion=True)
    except Exception:
        raise UserError(f"{file_name(path)} could not be added as an image.")


def images_to_pdf(inputs: list[str], output: str, page_size: str = "fit",
                  orientation: str = "auto", margin: float = 0.0) -> dict:
    if not inputs:
        raise UserError("Please add at least one image.")
    page_size = (page_size or "fit").lower()
    orientation = (orientation or "auto").lower()
    if page_size not in ("fit", "a4", "letter"):
        raise UserError('Page size must be "fit", "a4" or "letter".')
    if orientation not in ("auto", "portrait", "landscape"):
        raise UserError('Orientation must be "auto", "portrait" or "landscape".')
    check_output_path(output)
    for p in inputs:
        check_input_file(p, "image")
        if ext_of(p) not in IMAGE_EXTS:
            raise UserError(f"{file_name(p)} is not a supported image (PNG, JPG, BMP, GIF, TIFF, WEBP).")
    with MUPDF_LOCK:
        doc = pymupdf.open()
        try:
            for p in inputs:
                add_image_page(doc, p, page_size, orientation, margin)
            n = doc.page_count
            data = pdf_bytes(doc)
        finally:
            doc.close()
    write_bytes_safely(output, data)
    return {"output": output, "pages": n}


# =========================================================================== DOCX engines

def _word_available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Word.Application\CLSID"):
            pass
    except OSError:
        return False
    try:
        import win32com.client  # noqa: F401
    except Exception:
        return False
    return True


def _find_soffice() -> str | None:
    for name in ("soffice", "soffice.exe", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    candidates = [
        r"C:/Program Files/LibreOffice/program/soffice.exe",
        r"C:/Program Files (x86)/LibreOffice/program/soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
    ]
    return next((c for c in candidates if os.path.isfile(c)), None)


def docx_engines() -> dict:
    return {"word": _word_available(), "libreoffice": _find_soffice() is not None, "builtin": True}


def _convert_with_word(src: str, dst: str) -> None:
    import pythoncom  # type: ignore
    import win32com.client  # type: ignore

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    pythoncom.CoInitialize()
    word = None
    doc = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0
        doc = word.Documents.Open(os.path.abspath(src), ConfirmConversions=False,
                                  ReadOnly=True, AddToRecentFiles=False)
        doc.ExportAsFixedFormat(os.path.abspath(dst), 17)  # 17 = wdExportFormatPDF
    finally:
        try:
            if doc is not None:
                doc.Close(False)
        finally:
            if word is not None:
                word.Quit()
            pythoncom.CoUninitialize()


def _convert_with_libreoffice(src: str, dst: str) -> None:
    soffice = _find_soffice()
    if not soffice:
        raise RuntimeError("LibreOffice not found")
    with tempfile.TemporaryDirectory(prefix="catpdf-lo-") as tmp:
        profile = "file:///" + os.path.join(tmp, "profile").replace("\\", "/").lstrip("/")
        cmd = [soffice, f"-env:UserInstallation={profile}", "--headless", "--norestore",
               "--convert-to", "pdf", "--outdir", tmp, os.path.abspath(src)]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.run(cmd, capture_output=True, timeout=240, creationflags=flags)
        produced = os.path.join(tmp, os.path.splitext(os.path.basename(src))[0] + ".pdf")
        if not os.path.isfile(produced):
            err = (proc.stderr or proc.stdout or b"").decode(errors="replace").strip()
            raise RuntimeError(f"LibreOffice did not produce a PDF. {err}".strip())
        with open(produced, "rb") as f:
            data = f.read()
    write_bytes_safely(dst, data)


# ----------------------------------------------------------------- built-in engine

A4 = pymupdf.paper_rect("a4")
MARGIN = 56.7  # 2 cm
CONTENT_W = A4.width - 2 * MARGIN
CONTENT_H = A4.height - 2 * MARGIN - 18  # leave room for the page number

BUILTIN_CSS = """
body { font-family: sans-serif; font-size: 11pt; line-height: 1.4; color: #1a1a1a; }
p { margin: 0 0 7pt 0; }
h1 { font-size: 20pt; margin: 14pt 0 8pt 0; color: #111111; }
h2 { font-size: 16pt; margin: 12pt 0 6pt 0; color: #111111; }
h3 { font-size: 13.5pt; margin: 10pt 0 5pt 0; color: #222222; }
h4 { font-size: 12pt; margin: 8pt 0 4pt 0; }
h5, h6 { font-size: 11pt; margin: 8pt 0 4pt 0; }
ul, ol { margin: 0 0 7pt 0; padding-left: 20pt; }
li { margin: 0 0 2pt 0; }
li p { margin: 0; }
table { border-collapse: collapse; margin: 4pt 0 10pt 0; }
td, th { border: 0.75pt solid #8a8a8a; padding: 3pt 5pt; vertical-align: top; }
th { background-color: #eeeeee; font-weight: bold; }
td p, th p { margin: 0; }
img { margin: 2pt 0; }
a { color: #1a5fb4; text-decoration: underline; }
blockquote { margin: 6pt 0 6pt 16pt; color: #444444; }
pre, code { font-family: monospace; font-size: 9.5pt; }
sup, sub { font-size: 8pt; }
"""

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
_V = "{urn:schemas-microsoft-com:vml}"


def _docx_image_extents(path: str) -> list[tuple[float, float] | None]:
    """Display sizes (points) of the body images, in document order.

    mammoth doesn't expose the size an image has in the document, so we read it
    ourselves and match by order. Returns [] if anything goes wrong.
    """
    try:
        with zipfile.ZipFile(path) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except Exception:
        return []
    sizes: list[tuple[float, float] | None] = []
    for el in root.iter():
        if el.tag == f"{_W}drawing":
            ext = next((e for e in el.iter(f"{_WP}extent")), None)
            if ext is not None and _has_blip(el):
                try:
                    sizes.append((int(ext.get("cx")) / 12700.0, int(ext.get("cy")) / 12700.0))
                except (TypeError, ValueError):
                    sizes.append(None)
        elif el.tag == f"{_V}imagedata":
            sizes.append(None)
    return sizes


def _has_blip(el) -> bool:
    return any(child.tag.endswith("}blip") for child in el.iter())


def _image_html_attrs(image, extents: list, warnings: list[str]) -> dict:
    size = extents.pop(0) if extents else None
    try:
        with image.open() as f:
            raw = f.read()
    except Exception:
        warnings.append("An image could not be read and was skipped.")
        return {"src": "", "alt": image.alt_text or ""}
    content_type = (image.content_type or "").lower()
    width = height = None
    try:
        pil = Image.open(io.BytesIO(raw))
        pil.load()
        width, height = pil.size
        if content_type not in ("image/png", "image/jpeg", "image/gif", "image/bmp"):
            # MuPDF's HTML engine can't show EMF/WMF/TIFF etc.; convert what Pillow can read.
            out = io.BytesIO()
            pil = pil.convert("RGBA") if pil.mode in ("RGBA", "LA", "P") else pil.convert("RGB")
            pil.save(out, "PNG")
            raw, content_type = out.getvalue(), "image/png"
    except Exception:
        warnings.append(
            f"An image in format {content_type or 'unknown'} can't be shown by the built-in converter and was skipped."
        )
        return {"src": "", "alt": image.alt_text or ""}
    if size is None and width and height:
        size = (width * 0.75, height * 0.75)  # 96 dpi
    attrs = {
        "src": f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}",
        "alt": image.alt_text or "",
    }
    if size:
        w, h = size
        scale = min(1.0, CONTENT_W / max(w, 1), (CONTENT_H * 0.95) / max(h, 1))
        attrs["width"] = f"{max(1, round(w * scale))}"
        attrs["height"] = f"{max(1, round(h * scale))}"
    return attrs


def docx_to_html(src: str) -> tuple[str, list[str]]:
    import mammoth

    warnings: list[str] = []
    extents = _docx_image_extents(src)

    @mammoth.images.img_element
    def convert_image(image):
        return _image_html_attrs(image, extents, warnings)

    style_map = "\n".join([
        "p[style-name='Title'] => h1.title:fresh",
        "p[style-name='Subtitle'] => h2.subtitle:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
        "r[style-name='Strong'] => strong",
        "p[style-name='Caption'] => p.caption:fresh",
    ])
    try:
        with open(src, "rb") as f:
            result = mammoth.convert_to_html(f, convert_image=convert_image, style_map=style_map)
    except zipfile.BadZipFile:
        raise UserError(f"{file_name(src)} is not a valid .docx file.")
    except Exception as e:
        raise UserError(f"{file_name(src)} could not be read: {e}")
    html = re.sub(r'<img [^>]*src=""[^>]*/?>', "", result.value)
    seen = set()
    for msg in result.messages:
        text = getattr(msg, "message", str(msg))
        if "Unrecognised paragraph style" in text or "Unrecognised run style" in text:
            continue  # styles we don't map are rendered as plain paragraphs, which is fine
        if text not in seen and len(seen) < 8:
            seen.add(text)
            warnings.append(text)
    return html, warnings


def html_to_pdf_bytes(html: str, css: str = BUILTIN_CSS) -> bytes:
    """Lay out HTML on A4 pages with ~2 cm margins and page numbers."""
    buf = io.BytesIO()
    where = A4 + (MARGIN, MARGIN, -MARGIN, -MARGIN - 18)
    with MUPDF_LOCK:
        story = pymupdf.Story(html=f"<body>{html}</body>", user_css=css)
        writer = pymupdf.DocumentWriter(buf)
        more = 1
        pages = 0
        while more:
            dev = writer.begin_page(A4)
            more, filled = story.place(where)
            story.draw(dev)
            writer.end_page()
            pages += 1
            if pages > 5000:  # safety net against layout loops
                break
        writer.close()
        doc = pymupdf.open("pdf", buf.getvalue())
        try:
            if doc.page_count > 1:
                for i, page in enumerate(doc):
                    label = str(i + 1)
                    tw = pymupdf.get_text_length(label, fontname="helv", fontsize=9)
                    page.insert_text(((A4.width - tw) / 2, A4.height - MARGIN / 2 - 4), label,
                                     fontname="helv", fontsize=9, color=(0.45, 0.45, 0.45))
            return pdf_bytes(doc)
        finally:
            doc.close()


def _convert_builtin(src: str, dst: str) -> list[str]:
    if ext_of(src) not in DOCX_EXTS:
        raise UserError("The built-in converter only supports .docx files. "
                        "Save the document as .docx in your word processor first.")
    html, warnings = docx_to_html(src)
    if not html.strip():
        html = "<p></p>"
        warnings.append("The document looks empty.")
    data = html_to_pdf_bytes(html)
    write_bytes_safely(dst, data)
    return warnings


ENGINE_LABELS = {"word": "Microsoft Word", "libreoffice": "LibreOffice", "builtin": "built-in"}


def convert_docx(src: str, output: str, engine: str = "auto") -> dict:
    src_path = check_input_file(src, "Word document")
    check_output_path(output)
    engine = (engine or "auto").lower()
    if engine not in ("auto", "word", "libreoffice", "builtin"):
        raise UserError('Engine must be "auto", "word", "libreoffice" or "builtin".')
    if ext_of(src_path) not in (".docx", ".doc", ".docm", ".rtf", ".odt"):
        raise UserError(f"{file_name(src)} is not a Word document (.docx).")

    available = docx_engines()
    warnings: list[str] = []
    if engine == "auto":
        order = [e for e in ("word", "libreoffice") if available[e]] + ["builtin"]
    else:
        if not available[engine]:
            if engine == "word":
                raise UserError("Microsoft Word isn't installed on this computer. "
                                "Choose the Auto or Built-in engine instead.")
            raise UserError("LibreOffice wasn't found on this computer. "
                            "Choose the Auto or Built-in engine instead.")
        order = [engine]

    used = None
    last_error: Exception | None = None
    for eng in order:
        try:
            if eng == "word":
                _convert_with_word(src_path, check_output_path(output))
            elif eng == "libreoffice":
                _convert_with_libreoffice(src_path, output)
            else:
                warnings.extend(_convert_builtin(src_path, output))
                warnings.append("Converted with the built-in engine: complex layouts (columns, "
                                "text boxes, headers and footers) may look different than in Word.")
            used = eng
            break
        except UserError:
            raise
        except Exception as e:  # engine failed -> try the next one (auto) or report
            last_error = e
            if engine != "auto":
                raise UserError(f"{ENGINE_LABELS[eng]} could not convert {file_name(src)}: {e}")
            warnings.append(f"{ENGINE_LABELS[eng]} failed ({e}); trying the next engine.")
    if used is None:
        raise UserError(f"Could not convert {file_name(src)}: {last_error}")

    with MUPDF_LOCK:
        try:
            with pymupdf.open(check_output_path(output)) as d:
                pages = d.page_count
        except Exception:
            pages = 0
    return {"output": output, "engine": used, "pages": pages, "warnings": warnings}


def docx_to_pdf_document(src: str) -> tuple[pymupdf.Document, list[str]]:
    """Convert a DOCX with the auto engine into an in-memory PDF document (for merging)."""
    with tempfile.TemporaryDirectory(prefix="catpdf-docx-") as tmp:
        out = os.path.join(tmp, "converted.pdf")
        res = convert_docx(src, out, "auto")
        with open(out, "rb") as f:
            data = f.read()
    return pymupdf.open("pdf", data), res["warnings"]
