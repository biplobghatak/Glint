# crawl-service

Standalone Crawl4AI microservice. Renders a homepage headlessly and returns
cleaned markdown for `generate-icp`'s ICP generation.

## Endpoint

    POST /scrape
    headers: X-Crawl-Secret: <shared secret>
    body:    { "url": "https://example.com" }

    200 -> { "content": "<cleaned markdown>" }
    4xx/5xx -> { "error": "<reason>" }

`GET /health` -> `{ "ok": true }` (used by the Railway healthcheck).

## Local development

    python -m venv .venv
    .\.venv\Scripts\Activate.ps1      # PowerShell
    pip install -r requirements.txt
    python -m playwright install chromium
    pytest
    $env:CRAWL_SERVICE_SECRET = "dev-secret"; uvicorn app:app --reload

## Deploy (Railway)

1. Create a new Railway service from this repo, root directory `crawl-service/`
   (Railway auto-detects the Dockerfile).
2. Set environment variables: `CRAWL_SERVICE_SECRET` (a strong random value),
   optionally `SCRAPE_TIMEOUT_S`.
3. Deploy. Copy the generated public URL — it becomes `CRAWL_SERVICE_URL` on
   the `generate-icp` Edge Function (no trailing slash).
