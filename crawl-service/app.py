import os
import secrets

from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crawler import ScrapeError, scrape_homepage


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


CRAWL_SECRET = os.environ.get("CRAWL_SERVICE_SECRET", "")
SCRAPE_TIMEOUT_S = _env_float("SCRAPE_TIMEOUT_S", 25.0)

app = FastAPI(title="crawl-service")


class ScrapeRequest(BaseModel):
    url: str


@app.exception_handler(RequestValidationError)
async def _validation_error(_request, _exc):
    # Keep the documented 4xx contract: { "error": ... }, not Pydantic's default.
    return JSONResponse(status_code=422, content={"error": "invalid request body"})


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape")
async def scrape(
    body: ScrapeRequest,
    x_crawl_secret: str | None = Header(default=None),
):
    if not CRAWL_SECRET or not secrets.compare_digest(x_crawl_secret or "", CRAWL_SECRET):
        return JSONResponse(status_code=401, content={"error": "invalid secret"})
    try:
        content = await scrape_homepage(body.url, timeout_s=SCRAPE_TIMEOUT_S)
    except ScrapeError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return {"content": content}
