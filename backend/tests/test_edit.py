import base64

import pymupdf
import pytest

from conftest import make_pdf, page_texts, png_bytes


def spans(client, path, page):
    r = client.post("/pdf/text", json={"path": path, "page": page})
    assert r.status_code == 200, r.text
    return r.json()["spans"]


def find_span(client, path, page, text):
    return next(s for s in spans(client, path, page) if s["text"] == text)


def apply(client, body):
    r = client.post("/edit/apply", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def data_url(png):
    return "data:image/png;base64," + base64.b64encode(png).decode()


# ----------------------------------------------------------------- page order

def test_reorder_duplicate_rotate_import(client, tmp_path, pdf3):
    other = make_pdf(tmp_path / "other.pdf", pages=2, label="Other")
    out = str(tmp_path / "edited.pdf")
    j = apply(client, {
        "path": pdf3, "output": out,
        "pages": [
            {"src": 2, "rotate": 0},
            {"src": 0, "rotate": 90},
            {"src": 0, "rotate": 0},
            {"file": other, "src": 1, "rotate": 270},
        ],
        "edits": [],
    })
    assert j == {"output": out, "pages": 4}
    texts = page_texts(out)
    assert "Page 3" in texts[0]
    assert "Page 1" in texts[1] and "Page 1" in texts[2]
    assert "Other 2" in texts[3]
    with pymupdf.open(out) as d:
        assert [p.rotation for p in d] == [0, 90, 0, 270]
        assert d.metadata["title"] == "Three Pages"


def test_missing_pages_keeps_order_and_rotation_adds(client, tmp_path, rotated_pdf):
    out = str(tmp_path / "same.pdf")
    j = apply(client, {"path": rotated_pdf, "output": out, "edits": []})
    assert j["pages"] == 2
    assert ["Rot 1" in t for t in page_texts(out)] == [True, False]
    out2 = str(tmp_path / "rot.pdf")
    apply(client, {"path": rotated_pdf, "output": out2,
                   "pages": [{"src": 0, "rotate": 90}, {"src": 1, "rotate": 0}]})
    with pymupdf.open(out2) as d:
        assert [p.rotation for p in d] == [180, 90]


def test_bad_page_entries(client, tmp_path, pdf3):
    out = str(tmp_path / "x.pdf")
    r = client.post("/edit/apply", json={"path": pdf3, "output": out, "pages": [{"src": 5}]})
    assert r.status_code == 400 and "doesn't exist" in r.json()["detail"]
    r = client.post("/edit/apply", json={"path": pdf3, "output": out, "pages": [{"src": 0, "rotate": 45}]})
    assert r.status_code == 400
    r = client.post("/edit/apply", json={"path": pdf3, "output": out, "pages": []})
    assert r.status_code == 400
    r = client.post("/edit/apply", json={"path": pdf3, "output": out,
                                         "edits": [{"type": "explode", "page": 0, "bbox": [0, 0, 1, 1]}]})
    assert r.status_code == 400


# ----------------------------------------------------------------- replace text

def test_replace_text(client, tmp_path, pdf3):
    span = find_span(client, pdf3, 0, "Page 1")
    out = str(tmp_path / "replaced.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": span["bbox"], "text": "Intro",
        "size": span["size"], "color": "#d9480f", "bold": span["bold"], "italic": False,
        "serif": False, "mono": False,
    }]})
    texts = page_texts(out)
    assert "Page 1" not in texts[0]
    assert "Intro" in texts[0]
    # neighbouring lines untouched (tight leading must not be eaten by the redaction)
    assert "The quick brown fox jumps over the lazy dog." in texts[0]
    assert "Second line sits right below the first one." in texts[0]
    # other pages untouched
    assert "Page 2" in texts[1]
    new = find_span(client, out, 0, "Intro")
    assert new["color"] == "#d9480f"
    assert new["bold"] is True
    assert new["size"] == pytest.approx(18, abs=0.5)
    assert abs(new["bbox"][0] - span["bbox"][0]) < 2
    assert abs(new["bbox"][1] - span["bbox"][1]) < 6


def test_replace_text_tight_lines_only_target(client, tmp_path, pdf3):
    target = find_span(client, pdf3, 0, "The quick brown fox jumps over the lazy dog.")
    out = str(tmp_path / "r.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": target["bbox"], "text": "Replaced line",
        "size": target["size"], "color": "#000000"}]})
    t = page_texts(out)[0]
    assert "quick brown" not in t
    assert "Replaced line" in t
    assert "Second line sits right below the first one." in t
    assert "Page 1" in t


def test_replace_text_grows_right_before_shrinking(client, tmp_path, pdf3):
    target = find_span(client, pdf3, 0, "The quick brown fox jumps over the lazy dog.")
    out = str(tmp_path / "grow.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": target["bbox"],
        "text": "The quick orange cat jumps over the lazy dog and naps.",
        "size": target["size"], "color": "#000000"}]})
    new = [s for s in spans(client, out, 0) if "orange cat" in s["text"]]
    assert new and all(abs(s["size"] - target["size"]) < 0.01 for s in new)


def test_replace_text_shrinks_long_text(client, tmp_path, pdf3):
    span = find_span(client, pdf3, 0, "Page 1")
    long_text = ("A much much longer replacement title than before " * 4).strip()
    out = str(tmp_path / "long.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": span["bbox"], "text": long_text,
        "size": span["size"], "color": "#000000", "bold": True}]})
    joined = " ".join(page_texts(out)[0].split())
    assert long_text in joined
    new = [s for s in spans(client, out, 0) if "longer" in s["text"] or "much" in s["text"]]
    assert new and all(s["size"] < span["size"] for s in new)
    assert all(s["size"] >= 4 for s in new)


def test_replace_with_empty_text_deletes(client, tmp_path, pdf3):
    span = find_span(client, pdf3, 1, "Page 2")
    out = str(tmp_path / "del.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [{
        "type": "replace_text", "page": 1, "bbox": span["bbox"], "text": ""}]})
    assert "Page 2" not in page_texts(out)[1]


def test_unicode_text(client, tmp_path, pdf3):
    span = find_span(client, pdf3, 0, "Page 1")
    out = str(tmp_path / "u.pdf")
    apply(client, {"path": pdf3, "output": out, "edits": [
        {"type": "replace_text", "page": 0, "bbox": span["bbox"], "text": "Año €5 – “ok”", "size": 18},
        {"type": "add_text", "page": 0, "bbox": [72, 300, 400, 340], "text": "Ελληνικά ñandú", "size": 12},
    ]})
    t = page_texts(out)[0]
    assert "Año €5 – “ok”" in t
    assert "Ελληνικά ñandú" in t


# ----------------------------------------------------------------- add text / image / whiteout

def test_add_text_image_whiteout_follow_reorder(client, tmp_path, pdf3):
    out = str(tmp_path / "all.pdf")
    sig = png_bytes((200, 100), color=(0, 0, 0, 0), top_color=(10, 20, 200, 255))  # half transparent
    j = apply(client, {
        "path": pdf3, "output": out,
        "pages": [{"src": 1, "rotate": 0}, {"src": 0, "rotate": 0}, {"src": 1, "rotate": 0}],
        "edits": [
            {"type": "add_text", "page": 1, "bbox": [100, 500, 300, 560], "text": "Approved\nby Misu",
             "size": 14, "color": "#d9480f", "bold": True, "italic": False, "serif": True, "mono": False},
            {"type": "image", "page": 1, "bbox": [350, 650, 550, 750], "data": data_url(sig)},
            {"type": "whiteout", "page": 0, "bbox": [60, 100, 400, 140]},
        ],
    })
    assert j["pages"] == 3
    texts = page_texts(out)
    # page 1 (orig index 1) appears twice, both with the edits
    for i in (0, 2):
        assert "Approved" in texts[i] and "by Misu" in texts[i]
    assert "Approved" not in texts[1]
    with pymupdf.open(out) as d:
        for i in (0, 2):
            info = d[i].get_image_info()
            assert len(info) == 1
            bbox = pymupdf.Rect(info[0]["bbox"])
            assert bbox.x0 >= 349 and bbox.x1 <= 551 and bbox.y0 >= 649 and bbox.y1 <= 751
            assert info[0]["has-mask"] is True  # alpha kept
            # transparent bottom half shows the white page, top half is blue
            pix = d[i].get_pixmap(alpha=False)
            assert pix.pixel(450, 735) == (255, 255, 255)
            r, g, b = pix.pixel(450, 665)
            assert b > 150 and r < 80
        # whiteout covers the body text on original page 0 (now page 1) visually
        pix = d[1].get_pixmap(alpha=False)
        assert all(pix.pixel(x, 117) == (255, 255, 255) for x in range(72, 300, 7))
    new = find_span(client, out, 0, "Approved")
    assert new["serif"] is True and new["bold"] is True and new["color"] == "#d9480f"


def test_edits_not_applied_to_imported_pages(client, tmp_path, pdf3):
    other = make_pdf(tmp_path / "other.pdf", pages=1, label="Other")
    out = str(tmp_path / "imp.pdf")
    apply(client, {"path": pdf3, "output": out,
                   "pages": [{"file": other, "src": 0}, {"src": 0}],
                   "edits": [{"type": "add_text", "page": 0, "bbox": [72, 400, 300, 430], "text": "STAMP",
                              "size": 12}]})
    t = page_texts(out)
    assert "STAMP" not in t[0] and "STAMP" in t[1]


def test_bad_image_data(client, tmp_path, pdf3):
    r = client.post("/edit/apply", json={"path": pdf3, "output": str(tmp_path / "x.pdf"), "edits": [
        {"type": "image", "page": 0, "bbox": [0, 0, 100, 100], "data": "data:image/png;base64,AAAA"}]})
    assert r.status_code == 400


def test_save_over_input(client, tmp_path):
    p = make_pdf(tmp_path / "self.pdf", pages=2)
    apply(client, {"path": p, "output": p, "edits": [
        {"type": "add_text", "page": 0, "bbox": [72, 400, 300, 430], "text": "Overwritten", "size": 12}]})
    assert "Overwritten" in page_texts(p)[0]


# ----------------------------------------------------------------- rotated source pages

def _bbox_close(a, b, tol=2.5):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_page_replace_text_round_trip(client, tmp_path, rotation):
    """Content drawn on an unrotated page that was then given /Rotate: the text is sideways
    on screen. Spans are reported in display space; replacing via that bbox removes exactly
    that text and writes the new text in the same spot and the same on-screen direction."""
    src = make_pdf(tmp_path / f"r{rotation}.pdf", pages=1, rotation=rotation, label="Rot")
    span = find_span(client, src, 0, "Rot 1")
    out = str(tmp_path / f"r{rotation}-out.pdf")
    apply(client, {"path": src, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": span["bbox"], "text": "Rot 9", "size": span["size"],
        "color": "#000000", "bold": True}]})
    t = page_texts(out)[0]
    assert "Rot 1" not in t
    assert "Rot 9" in t
    assert "The quick brown fox jumps over the lazy dog." in t
    assert "Second line sits right below the first one." in t
    new = find_span(client, out, 0, "Rot 9")
    assert _bbox_close(new["bbox"], span["bbox"]), (new["bbox"], span["bbox"])
    assert new["size"] == pytest.approx(span["size"], abs=0.3)
    with pymupdf.open(out) as d:
        assert d[0].rotation == rotation


@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotated_page_with_upright_text(client, tmp_path, rotation):
    """Typical landscape scan / rotated form: /Rotate set and the text reads upright on screen."""
    src = str(tmp_path / f"u{rotation}.pdf")
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.set_rotation(rotation)
    for k, line in enumerate(["Invoice 2024-001", "Total due: 120 EUR", "Thank you"]):
        pt = pymupdf.Point(72, 90 + k * 14) * page.derotation_matrix
        page.insert_text(pt, line, fontsize=12, fontname="helv", rotate=rotation)
    doc.save(src)
    doc.close()
    span = find_span(client, src, 0, "Total due: 120 EUR")
    x0, y0, x1, y1 = span["bbox"]
    assert x1 - x0 > y1 - y0  # horizontal on screen
    assert abs(x0 - 72) < 1 and y0 < 90 + 14 < y1 + 4
    out = str(tmp_path / f"u{rotation}-out.pdf")
    apply(client, {"path": src, "output": out, "edits": [{
        "type": "replace_text", "page": 0, "bbox": span["bbox"], "text": "Total due: 99 EUR",
        "size": span["size"], "color": "#000000"}]})
    t = page_texts(out)[0]
    assert "120" not in t and "Total due: 99 EUR" in t
    assert "Invoice 2024-001" in t and "Thank you" in t
    new = find_span(client, out, 0, "Total due: 99 EUR")
    assert new["bbox"][2] - new["bbox"][0] > new["bbox"][3] - new["bbox"][1]
    assert abs(new["bbox"][0] - x0) < 1.5 and abs(new["bbox"][1] - y0) < 2.5
    assert new["size"] == pytest.approx(12, abs=0.3)


@pytest.mark.parametrize("rotation", [90, 270])
def test_rotated_page_image_and_whiteout_upright(client, tmp_path, rotation):
    src = make_pdf(tmp_path / f"i{rotation}.pdf", pages=1, rotation=rotation)
    # 2:1 image: top half red, bottom half blue
    img = png_bytes((200, 100), color=(0, 0, 255, 255), top_color=(255, 0, 0, 255))
    out = str(tmp_path / f"i{rotation}-out.pdf")
    apply(client, {"path": src, "output": out, "edits": [
        {"type": "image", "page": 0, "bbox": [400, 300, 600, 400], "data": data_url(img)},
        {"type": "whiteout", "page": 0, "bbox": [100, 450, 200, 500]},
        {"type": "add_text", "page": 0, "bbox": [100, 520, 400, 560], "text": "Hello there", "size": 16},
    ]})
    with pymupdf.open(out) as d:
        pg = d[0]
        assert (pg.rect.width, pg.rect.height) == (792, 612)
        pix = pg.get_pixmap(alpha=False)  # display space at scale 1
        r, g, b = pix.pixel(500, 320)
        assert r > 200 and b < 60, "top of the image should be red (upright)"
        r, g, b = pix.pixel(500, 380)
        assert b > 200 and r < 60, "bottom of the image should be blue"
        assert pix.pixel(105, 455) == (255, 255, 255)
    new = find_span(client, out, 0, "Hello there")
    x0, y0, x1, y1 = new["bbox"]
    assert abs(x0 - 100) < 3 and 518 <= y0 <= 530 and (x1 - x0) > (y1 - y0)
