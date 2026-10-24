"""PDF -> Markdown (clean context for AI agents) using pymupdf4llm."""
from __future__ import annotations

import base64
import datetime as _dt
import json
import os
import re
from pathlib import Path
from urllib.parse import quote

from .common import (
    MUPDF_LOCK,
    UserError,
    check_input_file,
    check_output_path,
    file_name,
    open_pdf,
    parse_page_range,
)

GENERATOR = "Cat PDF"


def _yaml_str(value) -> str:
    # JSON strings are valid YAML double-quoted scalars.
    return json.dumps(str(value or ""), ensure_ascii=False)


def _front_matter(source: str, title: str, author: str, pages: int) -> str:
    lines = [
        "---",
        # File name only: the .md is meant to be shared with AI tools, so don't leak local paths.
        f"source: {_yaml_str(os.path.basename(source))}",
        f"title: {_yaml_str(title)}",
        f"author: {_yaml_str(author)}",
        f"pages: {pages}",
        f"converted: {_dt.date.today().isoformat()}",
        f"generator: {GENERATOR}",
        "---",
        "",
    ]
    return "\n".join(lines) + "\n"


def _stats(markdown: str, pages: int) -> dict:
    chars = len(markdown)
    return {
        "pages": pages,
        "chars": chars,
        "words": len(markdown.split()),
        "approx_tokens": round(chars / 4),
    }


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)       # trailing spaces
    text = re.sub(r"\n{3,}", "\n\n", text)        # runs of blank lines
    # "# **Title**" -> "# Title": headings are already emphasised, the ** is just noise for an LLM.
    text = re.sub(r"(?m)^(#{1,6}) +\*\*(.+?)\*\* *$", r"\1 \2", text)
    return text.strip()


_DATA_IMG = re.compile(r"!\[([^\]]*)\]\(data:image/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\)")


def _extract_images(text: str, image_dir: str, rel_dir: str, page_no: int, counter: list) -> str:
    """Write base64-embedded images to *image_dir* and link them relative to the .md file.

    (pymupdf4llm's own write_images mangles paths containing spaces, so we let it embed
    the images and write the files ourselves.)
    """

    def fix(m: re.Match) -> str:
        alt, fmt, payload = m.group(1), m.group(2).lower(), m.group(3)
        ext = {"jpeg": "jpg", "svg+xml": "svg"}.get(fmt, fmt)
        counter[0] += 1
        name = f"page-{page_no:04d}-img-{counter[0]:03d}.{ext}"
        try:
            data = base64.b64decode(re.sub(r"\s+", "", payload))
        except Exception:
            return ""
        os.makedirs(image_dir, exist_ok=True)
        with open(os.path.join(image_dir, name), "wb") as f:
            f.write(data)
        return f"![{alt}]({quote(rel_dir)}/{quote(name)})"

    return _DATA_IMG.sub(fix, text)


def pdf_to_markdown(input: str, output: str | None = None, pages: str | None = None,
                    page_breaks: bool = True, include_images: bool = False,
                    front_matter: bool = True) -> dict:
    import pymupdf4llm

    src_path = check_input_file(input, "PDF")
    out_path = check_output_path(output) if output else None
    write_images = bool(include_images and out_path)
    image_dir = rel_dir = None
    if write_images:
        stem = Path(out_path).stem
        rel_dir = f"{stem}_images"
        image_dir = os.path.join(os.path.dirname(os.path.abspath(out_path)), rel_dir)

    with MUPDF_LOCK:
        doc = open_pdf(src_path)
        try:
            indexes = parse_page_range(pages, doc.page_count)
            meta = doc.metadata or {}
            title = (meta.get("title") or "").strip() or Path(src_path).stem
            author = (meta.get("author") or "").strip()
            kwargs = dict(
                pages=indexes,
                page_chunks=True,
                embed_images=write_images,
                show_progress=False,
                use_ocr=False,
            )
            if write_images:
                kwargs.update(image_format="png", dpi=150)
            try:
                chunks = pymupdf4llm.to_markdown(doc, **kwargs)
            except UserError:
                raise
            except Exception as e:
                raise UserError(f"Could not convert {file_name(src_path)} to Markdown: {e}")
        finally:
            doc.close()

    parts = []
    counter = [0]
    for n, chunk in enumerate(chunks):
        text = chunk.get("text", "") if isinstance(chunk, dict) else str(chunk)
        page_no = indexes[n] + 1 if n < len(indexes) else n + 1
        if write_images:
            text = _extract_images(text, image_dir, rel_dir, page_no, counter)
        text = _clean(text)
        if page_breaks:
            parts.append(f"<!-- page {page_no} -->\n\n{text}" if text else f"<!-- page {page_no} -->")
        elif text:
            parts.append(text)
    body = "\n\n".join(parts).strip() + "\n"
    markdown = (_front_matter(src_path, title, author, len(indexes)) if front_matter else "") + body

    if out_path:
        from .common import write_bytes_safely

        write_bytes_safely(out_path, markdown.encode("utf-8"))
    return {"markdown": markdown, "output": output if out_path else None,
            "stats": _stats(markdown, len(indexes))}
