import os
import re

import pymupdf
import pytest

from conftest import png_bytes


@pytest.fixture
def paper(tmp_path):
    path = str(tmp_path / "my paper.pdf")
    doc = pymupdf.open()
    img = png_bytes((300, 150), mode="RGB", color=(200, 30, 30, 255))
    for i in range(3):
        p = doc.new_page()
        p.insert_text((72, 80), f"Section {i + 1}", fontsize=24, fontname="hebo")
        y = 120
        for k in range(4):
            p.insert_text((72, y), f"Body text number {k} of section {i + 1}, about cats and boxes.",
                          fontsize=11)
            y += 16
        p.insert_image(pymupdf.Rect(72, 250, 372, 400), stream=img)
    doc.set_metadata({"title": "Cats: A Study", "author": "Dr. Misu"})
    doc.save(path)
    doc.close()
    return path


def test_markdown_preview_with_front_matter(client, paper):
    r = client.post("/convert/markdown", json={"input": paper, "output": None, "pages": None,
                                               "page_breaks": True, "include_images": False,
                                               "front_matter": True})
    assert r.status_code == 200, r.text
    j = r.json()
    md = j["markdown"]
    assert j["output"] is None
    assert md.startswith("---\n")
    fm = md.split("---\n")[1]
    assert 'title: "Cats: A Study"' in fm
    assert 'author: "Dr. Misu"' in fm
    assert "pages: 3" in fm
    assert re.search(r"converted: \d{4}-\d{2}-\d{2}", fm)
    assert "generator: Cat PDF" in fm
    assert "source:" in fm
    for n in (1, 2, 3):
        assert f"<!-- page {n} -->" in md
        assert f"Section {n}" in md
    assert md.index("<!-- page 1 -->") < md.index("Section 1") < md.index("<!-- page 2 -->")
    stats = j["stats"]
    assert stats["pages"] == 3
    assert stats["chars"] == len(md)
    assert stats["words"] == len(md.split())
    assert stats["approx_tokens"] == round(len(md) / 4)


def test_markdown_pages_no_breaks_no_front_matter(client, paper):
    j = client.post("/convert/markdown", json={"input": paper, "pages": "2-3", "page_breaks": False,
                                               "front_matter": False}).json()
    md = j["markdown"]
    assert not md.startswith("---")
    assert "<!-- page" not in md
    assert "Section 1" not in md and "Section 2" in md and "Section 3" in md
    assert j["stats"]["pages"] == 2


def test_markdown_write_with_images(client, paper, tmp_path):
    out = str(tmp_path / "out dir" / "my paper.md")
    r = client.post("/convert/markdown", json={"input": paper, "output": out, "pages": "1",
                                               "page_breaks": True, "include_images": True,
                                               "front_matter": False})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["output"] == out
    with open(out, encoding="utf-8") as f:
        written = f.read()
    assert written == j["markdown"]
    img_dir = os.path.join(os.path.dirname(out), "my paper_images")
    assert os.path.isdir(img_dir) and os.listdir(img_dir)
    links = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", written)
    assert links, written
    from urllib.parse import unquote
    for link in links:
        assert not os.path.isabs(unquote(link))
        assert unquote(link).startswith("my paper_images/")
        assert os.path.isfile(os.path.join(os.path.dirname(out), unquote(link)))


def test_markdown_errors(client, paper, tmp_path):
    r = client.post("/convert/markdown", json={"input": paper, "pages": "7"})
    assert r.status_code == 400
    r = client.post("/convert/markdown", json={"input": str(tmp_path / "nope.pdf")})
    assert r.status_code == 400 and r.json()["detail"].startswith("File not found")
