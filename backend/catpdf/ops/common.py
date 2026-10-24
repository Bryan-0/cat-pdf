"""Shared helpers for the PDF operations (no FastAPI imports here)."""
from __future__ import annotations

import os
import re
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

import pymupdf

# MuPDF is not thread-safe. FastAPI runs sync endpoints in a thread pool, so every
# piece of code that touches pymupdf objects runs under this (re-entrant) lock.
MUPDF_LOCK = threading.RLock()

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp"}
DOCX_EXTS = {".docx"}
PDF_EXTS = {".pdf"}


class UserError(Exception):
    """A problem with the user's input. The message is shown to the user verbatim (HTTP 400)."""


def file_name(path: str) -> str:
    return os.path.basename(str(path).replace("\\", "/").rstrip("/")) or str(path)


def check_input_file(path: str | None, what: str = "file") -> str:
    """Make sure *path* is an existing file and return it (normalised)."""
    if not path or not str(path).strip():
        raise UserError(f"No {what} was given.")
    p = os.path.normpath(str(path).strip())
    if not os.path.exists(p):
        raise UserError(f"File not found: {path}")
    if os.path.isdir(p):
        raise UserError(f"That is a folder, not a {what}: {path}")
    return p


def check_output_path(path: str | None) -> str:
    if not path or not str(path).strip():
        raise UserError("Please choose where to save the result.")
    p = os.path.normpath(str(path).strip())
    if os.path.isdir(p):
        raise UserError(f"The output path is a folder, please give a file name: {path}")
    return p


def ext_of(path: str) -> str:
    return Path(str(path)).suffix.lower()


def open_pdf(path: str) -> pymupdf.Document:
    """Open a PDF from disk with friendly errors (missing, not a PDF, password protected)."""
    p = check_input_file(path, "PDF")
    try:
        doc = pymupdf.open(p)
    except Exception:
        raise UserError(f"{file_name(path)} could not be opened. It may be damaged or not a PDF.")
    if not doc.is_pdf:
        doc.close()
        raise UserError(f"{file_name(path)} is not a PDF file.")
    if doc.needs_pass:
        doc.close()
        raise UserError(
            f"This PDF is password protected ({file_name(path)}). "
            "Please remove the password with another tool first."
        )
    if doc.page_count == 0:
        doc.close()
        raise UserError(f"{file_name(path)} has no pages.")
    return doc


@contextmanager
def opened_pdf(path: str):
    doc = open_pdf(path)
    try:
        yield doc
    finally:
        doc.close()


def check_page_index(doc: pymupdf.Document, page: int, path: str = "") -> int:
    try:
        page = int(page)
    except (TypeError, ValueError):
        raise UserError("The page number is not valid.")
    if page < 0 or page >= doc.page_count:
        name = f" {file_name(path)}" if path else " this document"
        raise UserError(
            f"Page {page + 1} doesn't exist -{name} has {doc.page_count} page"
            f"{'s' if doc.page_count != 1 else ''}."
        )
    return page


_RANGE_PART = re.compile(r"^(\d*)\s*-\s*(\d*)$")


def parse_page_range(spec: str | None, page_count: int) -> list[int]:
    """Parse a human 1-based page range like ``"1-3, 5, 8-"`` into 0-based indexes.

    Supports single pages, ``a-b`` (descending allowed: ``5-3``), open ends (``8-`` /
    ``-3``) and ``all``. Empty / None means every page. Order is preserved, duplicates allowed.
    """
    if spec is None:
        return list(range(page_count))
    text = str(spec).strip().lower()
    if text in ("", "all", "*"):
        return list(range(page_count))
    result: list[int] = []
    for raw in re.split(r"[,;]", text):
        part = raw.strip()
        if not part:
            continue
        if part.isdigit():
            a = b = int(part)
        else:
            m = _RANGE_PART.match(part)
            if not m or (not m.group(1) and not m.group(2)):
                raise UserError(
                    f'"{raw.strip()}" is not a valid page range. Use something like 1-3, 5, 8-10.'
                )
            a = int(m.group(1)) if m.group(1) else 1
            b = int(m.group(2)) if m.group(2) else page_count
        for n in (a, b):
            if n < 1 or n > page_count:
                raise UserError(
                    f"Page {n} doesn't exist - the document has {page_count} page"
                    f"{'s' if page_count != 1 else ''}."
                )
        step = 1 if b >= a else -1
        result.extend(i - 1 for i in range(a, b + step, step))
    if not result:
        raise UserError("The page range is empty.")
    return result


def write_bytes_safely(output: str, data: bytes) -> None:
    """Write *data* to *output* via a temp file + atomic replace (creates parent folders).

    This also makes "save over the input file" work, as long as callers close the
    source documents before calling this.
    """
    out = check_output_path(output)
    parent = os.path.dirname(os.path.abspath(out))
    try:
        os.makedirs(parent, exist_ok=True)
    except OSError as e:
        raise UserError(f"Couldn't create the folder {parent}: {e.strerror or e}")
    tmp = os.path.join(parent, f".{os.path.basename(out)}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, out)
    except PermissionError:
        _silent_remove(tmp)
        raise UserError(
            f"Couldn't save {file_name(out)} - it may be open in another program "
            "(close it there and try again), or the folder is read-only."
        )
    except OSError as e:
        _silent_remove(tmp)
        raise UserError(f"Couldn't save {file_name(out)}: {e.strerror or e}")


def _silent_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def pdf_bytes(doc: pymupdf.Document) -> bytes:
    return doc.tobytes(garbage=3, deflate=True)


def hex_to_rgb(color: str | None, default=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    if not color:
        return default
    c = str(color).strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        return default
    try:
        return tuple(int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return default


def int_to_hex(color: int) -> str:
    return f"#{(int(color) >> 16) & 255:02x}{(int(color) >> 8) & 255:02x}{int(color) & 255:02x}"
