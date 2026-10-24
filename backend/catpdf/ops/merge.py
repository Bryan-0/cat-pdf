"""Merge PDFs, images and DOCX files into one PDF."""
from __future__ import annotations

import pymupdf

from .common import (
    DOCX_EXTS,
    IMAGE_EXTS,
    MUPDF_LOCK,
    PDF_EXTS,
    UserError,
    check_input_file,
    check_output_path,
    ext_of,
    file_name,
    open_pdf,
    parse_page_range,
    pdf_bytes,
    write_bytes_safely,
)
from .convert import add_image_page, docx_to_pdf_document


def insert_pages(dst: pymupdf.Document, src: pymupdf.Document, indexes: list[int]) -> None:
    """Insert *indexes* of *src* into *dst*, grouping consecutive ascending runs."""
    if not indexes:
        return
    run_start = prev = indexes[0]
    for i in indexes[1:] + [None]:
        if i is not None and i == prev + 1:
            prev = i
            continue
        dst.insert_pdf(src, from_page=run_start, to_page=prev)
        if i is not None:
            run_start = prev = i


def merge_files(inputs: list[dict], output: str) -> dict:
    """*inputs*: list of ``{"path": str, "pages": str | None}``."""
    if not inputs:
        raise UserError("Please add at least one file to merge.")
    check_output_path(output)
    for item in inputs:
        p = check_input_file(item.get("path"))
        ext = ext_of(p)
        if ext not in PDF_EXTS | IMAGE_EXTS | DOCX_EXTS:
            raise UserError(
                f"{file_name(p)} can't be merged - only PDF, images (PNG, JPG, BMP, GIF, TIFF, WEBP) "
                "and Word (.docx) files are supported."
            )

    with MUPDF_LOCK:
        out = pymupdf.open()
        try:
            for item in inputs:
                path = item["path"]
                ext = ext_of(path)
                if ext in PDF_EXTS:
                    src = open_pdf(path)
                    try:
                        pages = parse_page_range(item.get("pages"), src.page_count)
                        insert_pages(out, src, pages)
                    except UserError as e:
                        raise UserError(f"{file_name(path)}: {e}")
                    finally:
                        src.close()
                elif ext in IMAGE_EXTS:
                    add_image_page(out, path, "fit")
                else:
                    src, _warnings = docx_to_pdf_document(path)
                    try:
                        pages = parse_page_range(item.get("pages"), src.page_count)
                        insert_pages(out, src, pages)
                    except UserError as e:
                        raise UserError(f"{file_name(path)}: {e}")
                    finally:
                        src.close()
            n = out.page_count
            if n == 0:
                raise UserError("The merged document would have no pages.")
            data = pdf_bytes(out)
        finally:
            out.close()
    write_bytes_safely(output, data)
    return {"output": output, "pages": n}
