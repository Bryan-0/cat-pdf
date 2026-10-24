import io
import os

import pymupdf
import pytest
from PIL import Image

from catpdf.ops import convert
from conftest import make_pdf, page_texts, png_bytes


# ----------------------------------------------------------------- merge

def test_merge_pdf_image_docx(client, tmp_path, pdf3, png_file, docx_file):
    other = make_pdf(tmp_path / "other.pdf", pages=4, label="Other")
    out = str(tmp_path / "out" / "nested" / "merged.pdf")
    r = client.post("/merge", json={"inputs": [
        {"path": pdf3, "pages": "1-2"},
        {"path": png_file},
        {"path": other, "pages": "4,1"},
        {"path": docx_file, "pages": None},
    ], "output": out})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["output"] == out
    assert os.path.isfile(out)
    texts = page_texts(out)
    assert j["pages"] == len(texts)
    assert "Page 1" in texts[0] and "Page 2" in texts[1]
    assert texts[2].strip() == ""  # image page
    assert "Other 4" in texts[3] and "Other 1" in texts[4]
    assert "Cat Report" in texts[5]
    assert len(texts) >= 6
    with pymupdf.open(out) as d:
        # image page sized to the image (200x100 px @ 96 dpi -> 150x75 pt)
        assert d[2].rect.width == pytest.approx(150, abs=0.5)
        assert d[2].rect.height == pytest.approx(75, abs=0.5)
        assert len(d[2].get_images()) == 1


def test_merge_errors(client, tmp_path, pdf3):
    bad = tmp_path / "notes.txt"
    bad.write_text("hi")
    r = client.post("/merge", json={"inputs": [{"path": str(bad)}], "output": str(tmp_path / "o.pdf")})
    assert r.status_code == 400 and "can't be merged" in r.json()["detail"]
    r = client.post("/merge", json={"inputs": [{"path": pdf3, "pages": "9"}], "output": str(tmp_path / "o.pdf")})
    assert r.status_code == 400 and "three.pdf" in r.json()["detail"]
    r = client.post("/merge", json={"inputs": [], "output": str(tmp_path / "o.pdf")})
    assert r.status_code == 400
    r = client.post("/merge", json={"inputs": [{"path": str(tmp_path / "missing.pdf")}],
                                    "output": str(tmp_path / "o.pdf")})
    assert r.status_code == 400 and r.json()["detail"].startswith("File not found")


def test_merge_can_overwrite_an_input(client, tmp_path):
    a = make_pdf(tmp_path / "a.pdf", pages=2, label="A")
    b = make_pdf(tmp_path / "b.pdf", pages=1, label="B")
    r = client.post("/merge", json={"inputs": [{"path": a}, {"path": b}], "output": a})
    assert r.status_code == 200, r.text
    assert r.json()["pages"] == 3


# ----------------------------------------------------------------- images -> pdf

@pytest.fixture
def two_images(tmp_path):
    a = tmp_path / "wide.png"
    a.write_bytes(png_bytes((400, 200), mode="RGBA", color=(0, 128, 0, 128)))
    # JPEG with EXIF orientation 6 (rotate 90 cw): stored 300x100 -> upright 100x300
    b = tmp_path / "rotated.jpg"
    img = Image.new("RGB", (300, 100), (200, 100, 0))
    exif = Image.Exif()
    exif[0x0112] = 6
    img.save(b, "JPEG", exif=exif.tobytes())
    c = tmp_path / "pal.gif"
    Image.new("P", (50, 50), 3).save(c)
    return [str(a), str(b), str(c)]


def test_images_fit(client, tmp_path, two_images):
    out = str(tmp_path / "photos.pdf")
    r = client.post("/convert/images", json={"inputs": two_images, "output": out,
                                             "page_size": "fit", "orientation": "auto", "margin": 0})
    assert r.status_code == 200, r.text
    assert r.json() == {"output": out, "pages": 3}
    with pymupdf.open(out) as d:
        assert (round(d[0].rect.width), round(d[0].rect.height)) == (300, 150)
        # EXIF orientation honoured: upright image is portrait
        w, h = d[1].rect.width, d[1].rect.height
        assert h == pytest.approx(3 * w, abs=0.5)  # 100x300 upright (size depends on JPEG dpi)
        info = d[1].get_image_info()[0]
        assert info["width"] == 100 and info["height"] == 300


def test_images_a4_letter(client, tmp_path, two_images):
    out = str(tmp_path / "a4.pdf")
    r = client.post("/convert/images", json={"inputs": two_images, "output": out,
                                             "page_size": "a4", "orientation": "auto", "margin": 36})
    assert r.status_code == 200, r.text
    with pymupdf.open(out) as d:
        assert (round(d[0].rect.width), round(d[0].rect.height)) == (842, 595)  # wide -> landscape
        assert (round(d[1].rect.width), round(d[1].rect.height)) == (595, 842)  # tall -> portrait
        bbox = pymupdf.Rect(d[0].get_image_info()[0]["bbox"])
        assert bbox.x0 >= 35.9 and bbox.y0 >= 35.9 and bbox.x1 <= 842 - 35.9
        # centred
        assert bbox.x0 == pytest.approx(842 - bbox.x1, abs=1)
        assert bbox.y0 == pytest.approx(595.3 - bbox.y1, abs=1)
    out2 = str(tmp_path / "letter.pdf")
    r = client.post("/convert/images", json={"inputs": two_images[:1], "output": out2,
                                             "page_size": "letter", "orientation": "portrait"})
    assert r.status_code == 200
    with pymupdf.open(out2) as d:
        assert (round(d[0].rect.width), round(d[0].rect.height)) == (612, 792)


def test_images_bad_input(client, tmp_path, pdf3):
    r = client.post("/convert/images", json={"inputs": [pdf3], "output": str(tmp_path / "x.pdf")})
    assert r.status_code == 400
    r = client.post("/convert/images", json={"inputs": [], "output": str(tmp_path / "x.pdf")})
    assert r.status_code == 400
    corrupt = tmp_path / "broken.png"
    corrupt.write_bytes(b"not a png")
    r = client.post("/convert/images", json={"inputs": [str(corrupt)], "output": str(tmp_path / "x.pdf")})
    assert r.status_code == 400 and "broken.png" in r.json()["detail"]


# ----------------------------------------------------------------- docx

def test_docx_engines(client):
    r = client.get("/convert/docx/engines")
    assert r.status_code == 200
    j = r.json()
    assert set(j) == {"word", "libreoffice", "builtin"}
    assert j["builtin"] is True
    assert all(isinstance(v, bool) for v in j.values())


def test_docx_builtin(client, tmp_path, docx_file):
    out = str(tmp_path / "report.pdf")
    r = client.post("/convert/docx", json={"input": docx_file, "output": out, "engine": "builtin"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["engine"] == "builtin" and j["output"] == out and j["pages"] >= 1
    assert isinstance(j["warnings"], list)
    with pymupdf.open(out) as d:
        page = d[0]
        assert page.rect.width == pytest.approx(595.28, abs=0.5)  # A4
        text = page.get_text()
        for needle in ("Cat Report", "important", "Shopping list", "Tuna", "Wake up", "Misu"):
            assert needle in text
        # margins ~2 cm
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        assert min(b[0] for b in blocks) >= 50
        imgs = page.get_image_info()
        assert len(imgs) == 1
        # 800x200 px image in the docx at 96 dpi = 600x150 pt -> scaled to content width
        bbox = pymupdf.Rect(imgs[0]["bbox"])
        assert bbox.width <= 595.28 - 2 * 56 + 1
        assert bbox.width > 400
        # table borders were drawn
        assert len(page.get_drawings()) > 0


def test_docx_builtin_multipage_has_page_numbers(tmp_path):
    from docx_builder import build_docx

    src = build_docx(tmp_path / "long.docx", extra_pages_text=80)
    out = str(tmp_path / "long.pdf")
    res = convert.convert_docx(src, out, "builtin")
    assert res["pages"] >= 2
    with pymupdf.open(out) as d:
        assert d[1].get_text().strip().endswith("2")


def test_docx_auto_uses_available_engine(client, tmp_path, docx_file):
    out = str(tmp_path / "auto.pdf")
    r = client.post("/convert/docx", json={"input": docx_file, "output": out, "engine": "auto"})
    assert r.status_code == 200, r.text
    engines = client.get("/convert/docx/engines").json()
    expected = "word" if engines["word"] else ("libreoffice" if engines["libreoffice"] else "builtin")
    assert r.json()["engine"] in (expected, "builtin")


def test_docx_unavailable_engines_report_nicely(client, tmp_path, docx_file, monkeypatch):
    monkeypatch.setattr(convert, "_word_available", lambda: False)
    monkeypatch.setattr(convert, "_find_soffice", lambda: None)
    for engine, word in (("word", "Word"), ("libreoffice", "LibreOffice")):
        r = client.post("/convert/docx", json={"input": docx_file, "output": str(tmp_path / "x.pdf"),
                                               "engine": engine})
        assert r.status_code == 400
        assert word in r.json()["detail"]
    assert client.get("/convert/docx/engines").json() == {"word": False, "libreoffice": False,
                                                          "builtin": True}


def test_docx_bad_file(client, tmp_path):
    bad = tmp_path / "bad.docx"
    bad.write_bytes(b"this is not a zip")
    r = client.post("/convert/docx", json={"input": str(bad), "output": str(tmp_path / "x.pdf"),
                                           "engine": "builtin"})
    assert r.status_code == 400
    assert "bad.docx" in r.json()["detail"]
