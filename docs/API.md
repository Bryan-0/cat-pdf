# Cat PDF — Backend API contract

The Python backend (`backend/catpdf`, FastAPI + uvicorn) runs **only on 127.0.0.1**. Electron spawns it:

```
backend/.venv/Scripts/python.exe -m catpdf --port <PORT>
env: CATPDF_TOKEN=<random hex>
```

- The process prints `CATPDF_READY <port>` to stdout once it's listening.
- `--dev` flag: token check disabled (for manual curl testing / `npm run backend`).
- Every request must carry the token in the `X-CatPDF-Token` header **or** a `token` query parameter (the query form exists so `<img src>` works). Missing/wrong token → `401`.
- CORS: allow all origins, methods and headers (the renderer is loaded from `file://`, so its origin is `null`). The token is what protects the API.
- The API is **path based**: the desktop app picks files with native dialogs and sends absolute paths. The backend reads inputs from those paths and writes outputs to the `output` path it's given (creating parent folders if needed). Nothing is uploaded anywhere.
- Errors: non-2xx with JSON `{"detail": "human friendly message"}`. Use `400` for bad input (missing file, wrong type, encrypted PDF, bad page range), `500` for unexpected failures. Messages are shown to the user verbatim, so keep them friendly.
- Page indexes are **0-based** in JSON. Page *range strings* (`"1-3,5"`) are **1-based**, human style.

## Coordinate system (important)

All coordinates exchanged with the frontend are **display space**: PDF points (1/72 in), origin at the **top-left of the page as it is rendered** (i.e. after the page's existing `/Rotate` is applied — exactly the space of the PNG returned by `/pdf/render`, divided by the render scale). `width`/`height` returned by the backend are the display-space size. The backend converts to/from PyMuPDF's unrotated space with `page.rotation_matrix` / `page.derotation_matrix`. A bbox is `[x0, y0, x1, y1]`.

---

## Endpoints

### `GET /health`
No token required. → `{"status": "ok", "app": "Cat PDF", "version": "1.0.0"}`

### `POST /pdf/info`
`{"path": "C:/x/a.pdf"}` →
```json
{"path": "...", "name": "a.pdf", "pages": 12, "title": "", "author": "",
 "encrypted": false, "size_bytes": 12345,
 "page_sizes": [[612.0, 792.0], ...]}
```
`page_sizes` are display-space `[width, height]` per page.

### `GET /pdf/render?path=...&page=0&width=300&token=...`
Returns `image/png` of the page rendered so the PNG is `width` pixels wide (default 300, clamp 50–2400). Cache renders in memory keyed by (path, mtime, page, width) — thumbnails are requested often. Sends `Cache-Control: no-cache`.

### `POST /pdf/text`
`{"path": "...", "page": 0}` →
```json
{"width": 612.0, "height": 792.0,
 "spans": [{"id": "0-3-1-0", "text": "Hello world", "bbox": [72.0, 70.1, 140.2, 84.0],
            "size": 11.0, "font": "Helvetica-Bold", "color": "#1a1a1a",
            "bold": true, "italic": false, "serif": false, "mono": false}]}
```
Spans come from `page.get_text("dict")` (text blocks only), whitespace-only spans dropped, bbox in display space. `id` is `"{page}-{block}-{line}-{span}"`. Used by the editor so the user can click existing text and change it.

### `POST /merge`
```json
{"inputs": [{"path": "C:/a.pdf", "pages": "1-3,5"}, {"path": "C:/b.png"}, {"path": "C:/c.docx"}],
 "output": "C:/out/merged.pdf"}
```
`pages` optional (null/missing = all, only meaningful for PDFs). Inputs may be **PDF, images** (png/jpg/jpeg/bmp/gif/tif/tiff/webp → one page each, page sized to the image) **or DOCX** (converted with the auto engine first). → `{"output": "...", "pages": 9}`

### `POST /edit/apply`
Applies an editor session to a PDF and saves it as a new file.
```json
{
  "path": "C:/in.pdf",
  "output": "C:/in-edited.pdf",
  "pages": [
    {"src": 2, "rotate": 0},
    {"src": 0, "rotate": 90},
    {"file": "C:/other.pdf", "src": 0, "rotate": 0}
  ],
  "edits": [
    {"type": "replace_text", "page": 0, "bbox": [72, 70, 140, 84], "text": "New text",
     "size": 11, "color": "#1a1a1a", "bold": false, "italic": false, "serif": false, "mono": false},
    {"type": "add_text", "page": 1, "bbox": [100, 500, 300, 530], "text": "Approved",
     "size": 14, "color": "#d9480f", "bold": true, "italic": false, "serif": false, "mono": false},
    {"type": "image", "page": 1, "bbox": [350, 650, 520, 710], "data": "data:image/png;base64,iVBOR..."},
    {"type": "whiteout", "page": 0, "bbox": [72, 100, 200, 120]}
  ]
}
```
- `pages` is the **final page order**. `src` = 0-based page index in `path` (or in `file` when given — pages imported from another PDF). `rotate` = extra clockwise rotation (0/90/180/270) added to the page's existing rotation. A `src` may appear more than once (duplicate page). Missing `pages` = keep original order.
- `edits[].page` refers to the **original** page index in `path` (edits travel with their page when reordered / duplicated). Edit bboxes are in the display space of the original page (before the extra `rotate`). Edits never apply to pages imported via `file`.
- `replace_text`: remove the original text under `bbox` (redaction with `images=PDF_REDACT_IMAGE_NONE`, no fill, so images/drawings are kept) then write `text` into that area with the closest Base-14 font (`helv`/`tiro`/`cour` + bold/italic variants), same size/color, rotated to match the page. If the new text doesn't fit, shrink the font until it does (min 4pt) rather than dropping it.
- `add_text`: write text in a box (multi-line allowed, `\n` separated), same font rules, no redaction.
- `image`: insert the PNG/JPEG data URL into `bbox` keeping aspect ratio (signatures, stamps). Transparency must be preserved.
- `whiteout`: draw a white filled rectangle (no border).
- Order of application: edits on the original document → assemble final page order → apply rotations → save with `garbage=3, deflate=True`.
→ `{"output": "...", "pages": 3}`

### `GET /convert/docx/engines`
→ `{"word": false, "libreoffice": false, "builtin": true}`

### `POST /convert/docx`
`{"input": "C:/a.docx", "output": "C:/a.pdf", "engine": "auto"}` (`auto|word|libreoffice|builtin`)
- `word`: Microsoft Word via COM (`pywin32`), best fidelity, only if Word is installed.
- `libreoffice`: `soffice --headless --convert-to pdf` if found (PATH or `C:/Program Files/LibreOffice/program/soffice.exe`).
- `builtin`: always available. `mammoth` (DOCX → HTML, images inlined) → `pymupdf.Story` (HTML → PDF, A4, ~2cm margins, sensible CSS for headings/tables/lists). Lower fidelity but no external software.
- `auto` = word → libreoffice → builtin.
→ `{"output": "...", "engine": "builtin", "pages": 3, "warnings": ["..."]}`

### `POST /convert/images`
```json
{"inputs": ["C:/1.jpg", "C:/2.png"], "output": "C:/photos.pdf",
 "page_size": "fit", "orientation": "auto", "margin": 0}
```
`page_size`: `fit` (page = image size) | `a4` | `letter`. `orientation`: `auto|portrait|landscape` (ignored for `fit`). `margin` in points. Images are scaled to fit and centred. EXIF orientation honoured. → `{"output": "...", "pages": 2}`

### `POST /convert/markdown`
PDF → Markdown, meant as clean context for AI agents.
```json
{"input": "C:/paper.pdf", "output": "C:/paper.md", "pages": null,
 "page_breaks": true, "include_images": false, "front_matter": true}
```
- Uses `pymupdf4llm.to_markdown` (headings, bold, tables, lists).
- `pages`: optional 1-based range string.
- `page_breaks`: insert `<!-- page N -->` markers between pages.
- `include_images`: extract images into a folder `<output stem>_images/` next to the .md and reference them relatively.
- `front_matter`: prepend YAML front matter: `source`, `title`, `author`, `pages`, `converted` (ISO date), `generator: Cat PDF`.
- `output` may be null → don't write, just return the markdown (preview).
→ `{"markdown": "...", "output": "C:/paper.md" | null, "stats": {"pages": 12, "chars": 34567, "words": 5400, "approx_tokens": 8642}}`
`approx_tokens` = `round(chars / 4)`.
