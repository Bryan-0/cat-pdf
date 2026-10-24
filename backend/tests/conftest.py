import io
import os
import sys

import pymupdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))  # backend/
sys.path.insert(0, HERE)

from catpdf.server import create_app  # noqa: E402
from docx_builder import build_docx  # noqa: E402

TOKEN = "test-token-123"


@pytest.fixture
def client():
    app = create_app(token=TOKEN, dev=False)
    with TestClient(app, headers={"X-CatPDF-Token": TOKEN}) as c:
        yield c


@pytest.fixture
def anon_client():
    app = create_app(token=TOKEN, dev=False)
    with TestClient(app) as c:
        yield c


def make_pdf(path, pages=3, rotation=0, size=(612, 792), label="Page", title="", author=""):
    """PDF whose page i says '<label> i+1' at (72, 80) plus a body line."""
    doc = pymupdf.open()
    for i in range(pages):
        p = doc.new_page(width=size[0], height=size[1])
        p.insert_text((72, 80), f"{label} {i + 1}", fontsize=18, fontname="hebo")
        p.insert_text((72, 120), "The quick brown fox jumps over the lazy dog.", fontsize=11)
        p.insert_text((72, 131), "Second line sits right below the first one.", fontsize=11)
        if rotation:
            p.set_rotation(rotation)
    if title or author:
        doc.set_metadata({"title": title, "author": author})
    doc.save(str(path))
    doc.close()
    return str(path)


def png_bytes(size=(120, 60), color=(220, 40, 40, 255), mode="RGBA", top_color=None):
    img = Image.new(mode, size, color if mode != "RGB" else color[:3])
    if top_color:
        for x in range(size[0]):
            for y in range(size[1] // 2):
                img.putpixel((x, y), top_color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def pdf3(tmp_path):
    return make_pdf(tmp_path / "three.pdf", pages=3, title="Three Pages", author="Misu")


@pytest.fixture
def rotated_pdf(tmp_path):
    return make_pdf(tmp_path / "rotated.pdf", pages=2, rotation=90, label="Rot")


@pytest.fixture
def png_file(tmp_path):
    p = tmp_path / "pic.png"
    p.write_bytes(png_bytes((200, 100)))
    return str(p)


@pytest.fixture
def docx_file(tmp_path):
    return build_docx(tmp_path / "report.docx", image_png=png_bytes((800, 200), mode="RGB",
                                                                     color=(30, 120, 200, 255)))


def page_texts(path):
    with pymupdf.open(path) as d:
        return [p.get_text() for p in d]
