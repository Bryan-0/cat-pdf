import io

import pymupdf
import pytest
from PIL import Image

from catpdf.ops.common import UserError, parse_page_range
from catpdf.ops.pages import RENDER_CACHE
from conftest import TOKEN, make_pdf


# ----------------------------------------------------------------- page ranges

@pytest.mark.parametrize("spec,expected", [
    (None, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    ("", list(range(10))),
    ("all", list(range(10))),
    ("1-3,5", [0, 1, 2, 4]),
    (" 1 - 3 , 5 ", [0, 1, 2, 4]),
    ("5-3", [4, 3, 2]),
    ("8-", [7, 8, 9]),
    ("-2", [0, 1]),
    ("2,2", [1, 1]),
    ("10", [9]),
    ("1;4", [0, 3]),
])
def test_parse_page_range(spec, expected):
    assert parse_page_range(spec, 10) == expected


@pytest.mark.parametrize("spec", ["0", "11", "1-11", "abc", "1-2-3", "-", "3,x"])
def test_parse_page_range_errors(spec):
    with pytest.raises(UserError):
        parse_page_range(spec, 10)


# ----------------------------------------------------------------- auth / health

def test_health_without_token(anon_client):
    r = anon_client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "app": "Cat PDF", "version": "1.0.0"}


def test_token_required(anon_client, pdf3):
    r = anon_client.post("/pdf/info", json={"path": pdf3})
    assert r.status_code == 401
    assert "detail" in r.json()
    r = anon_client.post("/pdf/info", json={"path": pdf3}, headers={"X-CatPDF-Token": "wrong"})
    assert r.status_code == 401
    r = anon_client.post("/pdf/info", json={"path": pdf3}, headers={"X-CatPDF-Token": TOKEN})
    assert r.status_code == 200


def test_token_query_param(anon_client, pdf3):
    r = anon_client.get("/pdf/render", params={"path": pdf3, "page": 0, "width": 100})
    assert r.status_code == 401
    r = anon_client.get("/pdf/render", params={"path": pdf3, "page": 0, "width": 100, "token": TOKEN})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"


def test_401_has_cors_headers(anon_client):
    r = anon_client.post("/pdf/info", json={"path": "x"}, headers={"Origin": "null"})
    assert r.status_code == 401
    assert r.headers.get("access-control-allow-origin") == "*"


def test_cors_preflight_without_token(anon_client):
    r = anon_client.options("/pdf/info", headers={
        "Origin": "null",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-catpdf-token",
    })
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") in ("*", "null")


def test_dev_mode_disables_token(pdf3):
    from fastapi.testclient import TestClient
    from catpdf.server import create_app

    with TestClient(create_app(token="x", dev=True)) as c:
        assert c.post("/pdf/info", json={"path": pdf3}).status_code == 200


# ----------------------------------------------------------------- info

def test_info(client, pdf3, rotated_pdf):
    r = client.post("/pdf/info", json={"path": pdf3})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["name"] == "three.pdf"
    assert j["pages"] == 3
    assert j["title"] == "Three Pages"
    assert j["author"] == "Misu"
    assert j["encrypted"] is False
    assert j["size_bytes"] > 0
    assert j["page_sizes"] == [[612.0, 792.0]] * 3
    # rotated pages report display-space size
    j = client.post("/pdf/info", json={"path": rotated_pdf}).json()
    assert j["page_sizes"][0] == [792.0, 612.0]


def test_missing_file(client, tmp_path):
    p = str(tmp_path / "nope.pdf")
    r = client.post("/pdf/info", json={"path": p})
    assert r.status_code == 400
    assert r.json()["detail"].startswith("File not found:")


def test_not_a_pdf(client, tmp_path):
    p = tmp_path / "fake.pdf"
    p.write_text("hello, not a pdf")
    r = client.post("/pdf/info", json={"path": str(p)})
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


def test_encrypted_pdf(client, tmp_path):
    path = str(tmp_path / "locked.pdf")
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "secret")
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="cat", owner_pw="owner")
    doc.close()
    for url, body in [("/pdf/info", {"path": path}), ("/pdf/text", {"path": path, "page": 0})]:
        r = client.post(url, json=body)
        assert r.status_code == 400
        assert "password protected" in r.json()["detail"]


def test_validation_error_is_400_with_string_detail(client):
    r = client.post("/pdf/info", json={})
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


# ----------------------------------------------------------------- render

def test_render_width_and_cache(client, pdf3, rotated_pdf):
    RENDER_CACHE.clear()
    r = client.get("/pdf/render", params={"path": pdf3, "page": 1, "width": 306})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    img = Image.open(io.BytesIO(r.content))
    assert abs(img.width - 306) <= 1
    assert abs(img.height - 396) <= 1
    assert len(RENDER_CACHE) == 1
    r2 = client.get("/pdf/render", params={"path": pdf3, "page": 1, "width": 306})
    assert r2.content == r.content
    assert len(RENDER_CACHE) == 1
    # clamping
    img = Image.open(io.BytesIO(client.get("/pdf/render", params={"path": pdf3, "width": 5}).content))
    assert img.width == 50
    img = Image.open(io.BytesIO(client.get("/pdf/render", params={"path": pdf3, "width": 99999}).content))
    assert img.width == 2400
    # rotated: landscape image
    img = Image.open(io.BytesIO(client.get("/pdf/render", params={"path": rotated_pdf, "width": 792}).content))
    assert (img.width, img.height) == (792, 612)


def test_render_cache_invalidated_on_change(client, tmp_path):
    RENDER_CACHE.clear()
    path = make_pdf(tmp_path / "c.pdf", pages=1)
    a = client.get("/pdf/render", params={"path": path, "width": 200}).content
    make_pdf(tmp_path / "c.pdf", pages=1, size=(300, 300))
    import os
    import time
    os.utime(path, (time.time() + 5, time.time() + 5))
    b = client.get("/pdf/render", params={"path": path, "width": 200}).content
    assert Image.open(io.BytesIO(b)).height == 200
    assert a != b


def test_render_bad_page(client, pdf3):
    r = client.get("/pdf/render", params={"path": pdf3, "page": 7})
    assert r.status_code == 400
    assert "doesn't exist" in r.json()["detail"]


# ----------------------------------------------------------------- text

def test_text_spans(client, pdf3):
    r = client.post("/pdf/text", json={"path": pdf3, "page": 2})
    assert r.status_code == 200
    j = r.json()
    assert j["width"] == 612.0 and j["height"] == 792.0
    texts = [s["text"] for s in j["spans"]]
    assert "Page 3" in texts
    span = next(s for s in j["spans"] if s["text"] == "Page 3")
    assert span["id"].startswith("2-")
    assert span["bold"] is True and span["serif"] is False and span["mono"] is False
    assert span["size"] == 18.0
    assert span["color"] == "#000000"
    x0, y0, x1, y1 = span["bbox"]
    assert 71 <= x0 <= 73 and y0 < 80 < y1
    assert all(s["text"].strip() for s in j["spans"])


def test_text_spans_rotated_are_display_space(client, rotated_pdf):
    j = client.post("/pdf/text", json={"path": rotated_pdf, "page": 0}).json()
    assert (j["width"], j["height"]) == (792.0, 612.0)
    span = next(s for s in j["spans"] if s["text"] == "Rot 1")
    x0, y0, x1, y1 = span["bbox"]
    # Unrotated (72, ~62..84) on a 612x792 page rotated 90 cw -> near the top-right in display.
    assert x0 > 600 and x1 <= 792
    assert 70 <= y0 <= 74
    # Check against the actual pixels of a render at scale 1.
    png = pymupdf.open(rotated_pdf)[0].get_pixmap(alpha=False)
    dark = [(x, y) for y in range(png.height) for x in range(png.width)
            if png.pixel(x, y)[0] < 100 and x > 695 and y < 200]
    xs = [p[0] for p in dark]
    ys = [p[1] for p in dark]
    assert x0 - 2 <= min(xs) and max(xs) <= x1 + 2
    assert y0 - 2 <= min(ys)
