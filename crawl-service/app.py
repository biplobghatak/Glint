import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from crawler import ScrapeError, scrape_homepage

CRAWL_SECRET = os.environ.get("CRAWL_SERVICE_SECRET", "")
SCRAPE_TIMEOUT_S = float(os.environ.get("SCRAPE_TIMEOUT_S", "25"))

app = FastAPI(title="crawl-service")


class ScrapeRequest(BaseModel):
    url: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape")
async def scrape(
    body: ScrapeRequest,
    x_crawl_secret: str | None = Header(default=None),
):
    if not CRAWL_SECRET or x_crawl_secret != CRAWL_SECRET:
        raise HTTPException(status_code=401, detail="invalid secret")
    try:
        content = await scrape_homepage(body.url, timeout_s=SCRAPE_TIMEOUT_S)
    except ScrapeError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return {"content": content}
