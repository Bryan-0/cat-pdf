# Cat PDF backend

Local Python service (FastAPI + uvicorn + PyMuPDF) that does all the PDF work for the
Electron app. It only listens on `127.0.0.1` and never uploads anything.

## Run

```powershell
cd backend
.venv\Scripts\python.exe -m pip install -r requirements.txt   # once (scripts\setup.ps1 does this)

# How Electron starts it: token from the environment, prints "CATPDF_READY <port>" when listening
$env:CATPDF_TOKEN = "some-secret"; .venv\Scripts\python.exe -m catpdf --port 8765

# Manual testing: no token check, request logging, Swagger UI at http://127.0.0.1:8765/docs
.venv\Scripts\python.exe -m catpdf --port 8765 --dev        # same as `npm run backend`
```

Options: `--port N` (0 = any free port; the real one is printed), `--host` (default
`127.0.0.1`), `--dev`. Requests need the `X-CatPDF-Token` header or a `token` query
parameter (`/health` and CORS preflights are exempt).

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -q        # or: npm run test:backend
```

The tests build their own PDFs, images and .docx files on the fly (`tests/docx_builder.py`).

## Endpoints

The full contract is in [`docs/API.md`](../docs/API.md). Summary:

| Endpoint | What it does |
|---|---|
| `GET /health` | liveness, no token |
| `POST /pdf/info` | page count, metadata, display-space page sizes |
| `GET /pdf/render` | page → PNG of a given width (LRU cache, 300 entries) |
| `POST /pdf/text` | text spans with display-space bboxes and font traits |
| `POST /merge` | PDFs (with page ranges) + images + DOCX → one PDF |
| `POST /edit/apply` | replace/add text, images (signatures), white-out, reorder/duplicate/rotate/import pages |
| `GET /convert/docx/engines`, `POST /convert/docx` | DOCX → PDF |
| `POST /convert/images` | images → PDF (`fit` / `a4` / `letter`, EXIF orientation honoured) |
| `POST /convert/markdown` | PDF → Markdown for AI agents (pymupdf4llm) |

## Code layout

- `catpdf/__main__.py` – CLI, uvicorn startup, `CATPDF_READY` line.
- `catpdf/server.py` – FastAPI app: token middleware, CORS, request models, error mapping
  (`UserError` → 400 with a friendly `detail`, anything else → 500).
- `catpdf/ops/` – the operations as plain functions (no FastAPI): `pages.py` (info, render,
  text), `merge.py`, `edit.py`, `convert.py` (images + DOCX engines), `markdown.py`,
  `common.py` (page ranges, safe saving, errors). MuPDF isn't thread-safe, so PyMuPDF work
  runs under one re-entrant lock (`common.MUPDF_LOCK`).

## DOCX engines

`auto` tries them in this order:

1. **word** – Microsoft Word via COM (`pywin32`). Best fidelity. Used only if Word is installed
   (`Word.Application` registered).
2. **libreoffice** – `soffice --headless --convert-to pdf` (PATH or the default install folder),
   run with a throw-away profile.
3. **builtin** – always available: `mammoth` (DOCX → HTML) → `pymupdf.Story` (HTML → PDF) on A4
   with 2 cm margins and page numbers. Headings, paragraphs, bold/italic, lists, bordered
   tables and images (scaled to the page width) come through; columns, text boxes,
   headers/footers and exact fonts don't. The response's `warnings` says so.

Asking explicitly for an engine that isn't installed returns a 400 with a friendly message.

## Notes on editing

- Coordinates are display space (after `/Rotate`); converted with
  `page.derotation_matrix` (display → unrotated) / `page.rotation_matrix` (back).
- `replace_text` removes the characters whose centre lies in the bbox (redaction bands
  through the middle of the line, so tightly spaced neighbouring lines survive; images and
  vector graphics are kept), then writes the new text in the same on-screen direction as
  the old text, with the matching Base-14 family (Helvetica/Times/Courier, embedded so
  accents, €, Greek and Cyrillic work). Text that doesn't fit is shrunk (min 4 pt); a replaced
  single line stays a single line.
- Outputs are written via a temp file + atomic rename, so saving over an input works.
