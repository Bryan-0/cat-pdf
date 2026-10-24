"""FastAPI app for Cat PDF. Contract: docs/API.md."""
from __future__ import annotations

import logging
import secrets
import traceback
from typing import Any, Callable, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from . import APP_NAME, __version__
from .ops import convert, edit, markdown, merge, pages
from .ops.common import UserError

log = logging.getLogger("catpdf")

TOKEN_HEADER = "X-CatPDF-Token"


# --------------------------------------------------------------------------- models

class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class PathRequest(_Model):
    path: str


class TextRequest(_Model):
    path: str
    page: int = 0


class MergeInput(_Model):
    path: str
    pages: Optional[str] = None


class MergeRequest(_Model):
    inputs: list[MergeInput]
    output: str


class PageEntry(_Model):
    src: int = 0
    rotate: int = 0
    file: Optional[str] = None


class EditItem(_Model):
    type: str
    page: int = 0
    bbox: list[float] = Field(default_factory=list)
    text: Optional[str] = None
    size: Optional[float] = None
    color: Optional[str] = None
    bold: bool = False
    italic: bool = False
    serif: bool = False
    mono: bool = False
    data: Optional[str] = None


class EditRequest(_Model):
    path: str
    output: str
    pages: Optional[list[PageEntry]] = None
    edits: list[EditItem] = Field(default_factory=list)


class DocxRequest(_Model):
    input: str
    output: str
    engine: str = "auto"


class ImagesRequest(_Model):
    inputs: list[str]
    output: str
    page_size: str = "fit"
    orientation: str = "auto"
    margin: float = 0


class MarkdownRequest(_Model):
    input: str
    output: Optional[str] = None
    pages: Optional[str] = None
    page_breaks: bool = True
    include_images: bool = False
    front_matter: bool = True


# --------------------------------------------------------------------------- helpers

def run_op(fn: Callable, *args, **kwargs) -> Any:
    """Run an operation, mapping errors to friendly HTTP errors."""
    try:
        return fn(*args, **kwargs)
    except UserError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except MemoryError:
        raise HTTPException(status_code=500, detail="Ran out of memory - the file may be too large.")
    except Exception as e:  # unexpected: log the traceback, show a short message
        log.error("Unexpected error in %s:\n%s", getattr(fn, "__name__", fn), traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Something went wrong: {e}")


def _validation_message(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query"))
        msg = err.get("msg", "invalid value")
        parts.append(f"{loc}: {msg}" if loc else msg)
    if not parts:
        return "The request was not valid."
    return "The request was not valid (" + "; ".join(parts) + ")."


# --------------------------------------------------------------------------- app

def create_app(token: Optional[str] = None, dev: bool = False) -> FastAPI:
    app = FastAPI(title=APP_NAME, version=__version__, docs_url="/docs" if dev else None,
                  redoc_url=None, openapi_url="/openapi.json" if dev else None)
    app.state.token = token or ""
    app.state.dev = dev

    @app.middleware("http")
    async def token_check(request: Request, call_next):
        if dev or request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)
        expected = app.state.token
        given = request.headers.get(TOKEN_HEADER) or request.query_params.get("token") or ""
        if not expected or not secrets.compare_digest(given.encode(), expected.encode()):
            return JSONResponse({"detail": "Missing or invalid token."}, status_code=401)
        return await call_next(request)

    # Added after the token middleware => outermost, so even 401s carry CORS headers.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                       allow_headers=["*"], expose_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_request: Request, exc: RequestValidationError):
        return JSONResponse({"detail": _validation_message(exc)}, status_code=400)

    @app.exception_handler(UserError)
    async def user_error_handler(_request: Request, exc: UserError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    # ---------------------------------------------------------------- routes

    @app.get("/health")
    def health():
        return {"status": "ok", "app": APP_NAME, "version": __version__}

    @app.post("/pdf/info")
    def pdf_info(req: PathRequest):
        return run_op(pages.pdf_info, req.path)

    @app.get("/pdf/render")
    def pdf_render(path: str = Query(...), page: int = Query(0), width: int = Query(300)):
        png = run_op(pages.render_page, path, page, width)
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-cache"})

    @app.post("/pdf/text")
    def pdf_text(req: TextRequest):
        return run_op(pages.page_text_spans, req.path, req.page)

    @app.post("/merge")
    def merge_files(req: MergeRequest):
        return run_op(merge.merge_files, [i.model_dump() for i in req.inputs], req.output)

    @app.post("/edit/apply")
    def edit_apply(req: EditRequest):
        page_list = [p.model_dump() for p in req.pages] if req.pages is not None else None
        return run_op(edit.apply_edits, req.path, req.output, page_list,
                      [e.model_dump() for e in req.edits])

    @app.get("/convert/docx/engines")
    def docx_engines():
        return run_op(convert.docx_engines)

    @app.post("/convert/docx")
    def convert_docx(req: DocxRequest):
        return run_op(convert.convert_docx, req.input, req.output, req.engine)

    @app.post("/convert/images")
    def convert_images(req: ImagesRequest):
        return run_op(convert.images_to_pdf, req.inputs, req.output, req.page_size,
                      req.orientation, req.margin)

    @app.post("/convert/markdown")
    def convert_markdown(req: MarkdownRequest):
        return run_op(markdown.pdf_to_markdown, req.input, req.output, req.pages,
                      req.page_breaks, req.include_images, req.front_matter)

    return app
