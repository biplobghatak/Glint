# Crawl4AI-Powered ICP Generation (Spec A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `fetch()` + regex HTML-strip inside the `generate-icp` Edge Function with a homepage scrape performed by a new standalone Crawl4AI microservice (`crawl-service`), so JS-rendered sites produce cleaner content for ICP generation.

**Architecture:** A new Python/FastAPI service `crawl-service/` (sibling of `web/` and `extension/`) wraps Crawl4AI (headless Chromium via Playwright) behind a single authenticated `POST /scrape` endpoint, deployed as an always-on Railway container. `generate-icp` swaps its `fetchSiteText()` implementation to call `/scrape` synchronously with a shared-secret header; everything downstream (`MIN_CONTENT_LENGTH` gate, `ICP_SCHEMA`, `callLLMJson`, `needs_manual_input` contract) is unchanged. Any crawl-service failure folds into the existing `needs_manual_input` fallback — no new UI states.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, Crawl4AI (Playwright/Chromium), pytest; Deno 2 Edge Functions (TypeScript); Railway (Dockerfile deploy); Supabase CLI for function deploy + secrets.

All paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **Endpoint contract is fixed** (copy verbatim): `POST /scrape`, header `X-Crawl-Secret: <shared secret>`, body `{ "url": "https://example.com" }`; `200 → { "content": "<cleaned markdown>" }`; `4xx/5xx → { "error": "<reason>" }`.
- **Shared secret env var is `CRAWL_SERVICE_SECRET`** — set identically as a Supabase Edge Function secret and a Railway environment variable. The service is never called directly by the browser.
- **`generate-icp` treats every non-2xx / timeout / thrown error from crawl-service identically** → the existing `{ needs_manual_input: true }` response. No infra-specific error is surfaced to the user; a `console.error` on the Edge side is sufficient.
- **`MIN_CONTENT_LENGTH = 200` is unchanged**, as is `ICP_SCHEMA`, the `callLLMJson` call, and the `{ target_roles, company_types, pain_points, raw_summary }` shape.
- **Homepage only** — the crawler navigates to the given URL and does not follow links. (A future `depth`/`max_pages` param is explicitly out of scope.)
- **Timeout budget ~20–30s end-to-end.** crawl-service self-bounds its render at `SCRAPE_TIMEOUT_S` (default 25s); `generate-icp` sets an outer `AbortSignal.timeout(30000)` so it never hangs.
- **No changes** to `web/app/onboarding/onboarding-flow.tsx`, the `icps` table schema, or RLS policies.
- **No background-job orchestration** (Inngest etc.) — one synchronous HTTP round-trip inside one Edge Function invocation.

---

### Task 1: Scaffold `crawl-service` and the Crawl4AI wrapper

Stand up the Python project and the single function that turns a URL into cleaned markdown, raising a typed error on any failure. Project scaffolding (requirements, pytest config) is folded in because the wrapper's tests need it.

**Files:**
- Create: `crawl-service/requirements.txt`
- Create: `crawl-service/pytest.ini`
- Create: `crawl-service/.gitignore`
- Create: `crawl-service/crawler.py`
- Create: `crawl-service/tests/__init__.py`
- Test: `crawl-service/tests/test_crawler.py`

**Interfaces:**
- Produces: `scrape_homepage(url: str, timeout_s: float = 25.0) -> str` — returns non-empty cleaned markdown, or raises `ScrapeError` (an `Exception` subclass) on render failure / timeout / empty content. Both are importable from `crawler`.

- [ ] **Step 1: Create the project scaffolding**

`crawl-service/requirements.txt`:
```
crawl4ai~=0.4.0
fastapi~=0.115.0
uvicorn[standard]~=0.32.0
pydantic~=2.9
pytest~=8.3
pytest-asyncio~=0.24.0
httpx~=0.27
```

`crawl-service/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
```

`crawl-service/.gitignore`:
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.env
```

`crawl-service/tests/__init__.py`: (empty file)

- [ ] **Step 2: Create the virtualenv and install (PowerShell)**

Run (in `crawl-service/`):
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
```
Expected: dependencies install and Chromium downloads without error. (`python -m playwright install chromium` provides the browser the wrapper renders with; on CI/Docker this is handled by the Dockerfile in Task 3.)

- [ ] **Step 3: Write the failing tests**

`crawl-service/tests/test_crawler.py`:
```python
import pytest

from crawler import scrape_homepage, ScrapeError

# A self-contained fixture rendered via Crawl4AI's raw:// scheme — no network.
FIXTURE_HTML = (
    "<html><head><title>Acme Analytics</title></head><body>"
    "<nav>Home About Pricing</nav>"
    "<main><h1>Acme Analytics</h1>"
    "<p>Acme Analytics helps B2B revenue teams forecast pipeline and "
    "spot at-risk deals before they slip. Sales leaders use Acme to "
    "replace spreadsheet guesswork with model-driven forecasts that "
    "update as deals move through the funnel.</p></main>"
    "<footer>Copyright Acme</footer></body></html>"
)


async def test_scrape_extracts_markdown():
    content = await scrape_homepage(f"raw://{FIXTURE_HTML}")
    assert "Acme Analytics" in content
    assert "forecast pipeline" in content
    assert len(content) > 100


async def test_scrape_unreachable_url_raises():
    # Port 1 on loopback refuses immediately — a fast, deterministic failure.
    with pytest.raises(ScrapeError):
        await scrape_homepage("http://127.0.0.1:1/", timeout_s=5)
```

- [ ] **Step 4: Run the tests to verify they fail**

Run (in `crawl-service/`, venv active): `pytest tests/test_crawler.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'crawler'` (or `ImportError` for `scrape_homepage`).

- [ ] **Step 5: Implement the wrapper**

`crawl-service/crawler.py`:
```python
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig


class ScrapeError(Exception):
    """Raised when a page cannot be rendered or yields no usable content."""


async def scrape_homepage(url: str, timeout_s: float = 25.0) -> str:
    """Render `url`'s homepage headlessly and return cleaned markdown.

    Homepage only — no link following. Raises ScrapeError on navigation
    failure, render timeout, or empty extraction.
    """
    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=int(timeout_s * 1000),
    )
    try:
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
    except Exception as exc:  # navigation / render / timeout errors
        raise ScrapeError(str(exc)) from exc

    if not result.success:
        raise ScrapeError(result.error_message or "crawl failed")

    # Crawl4AI 0.4.x returns either a str or a MarkdownGenerationResult;
    # handle both. The markdown generator already omits script/style/nav noise.
    markdown = result.markdown
    content = (getattr(markdown, "raw_markdown", None) or str(markdown or "")).strip()
    if not content:
        raise ScrapeError("no content extracted")
    return content
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pytest tests/test_crawler.py -v`
Expected: PASS (2 passed). (First run launches Chromium; allow a few seconds.)

- [ ] **Step 7: Commit**

```bash
git add crawl-service/requirements.txt crawl-service/pytest.ini crawl-service/.gitignore crawl-service/crawler.py crawl-service/tests
git commit -m "feat(crawl-service): add Crawl4AI homepage scraper wrapper"
```

---

### Task 2: FastAPI `/scrape` endpoint with shared-secret auth

Expose `scrape_homepage` over HTTP behind the `X-Crawl-Secret` check, mapping `ScrapeError` to a clean `502 { "error": ... }` and success to `200 { "content": ... }`. Add a `/health` route for Railway's healthcheck.

**Files:**
- Create: `crawl-service/app.py`
- Test: `crawl-service/tests/test_app.py`

**Interfaces:**
- Consumes: `scrape_homepage`, `ScrapeError` from `crawler` (Task 1).
- Produces: FastAPI `app` object with `POST /scrape` (body `{ "url": str }`, header `X-Crawl-Secret`) and `GET /health`. Module-level `CRAWL_SECRET` and `SCRAPE_TIMEOUT_S` read from env at import.

- [ ] **Step 1: Write the failing tests**

`crawl-service/tests/test_app.py`:
```python
from fastapi.testclient import TestClient

import app as app_module
from app import app, ScrapeError

client = TestClient(app)


def test_endpoint_rejects_missing_or_wrong_secret(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")
    r_missing = client.post("/scrape", json={"url": "https://example.com"})
    assert r_missing.status_code == 401
    r_wrong = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "wrong"},
    )
    assert r_wrong.status_code == 401


def test_endpoint_returns_content_on_success(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")

    async def fake_scrape(url, timeout_s=25.0):
        return "cleaned markdown content"

    monkeypatch.setattr(app_module, "scrape_homepage", fake_scrape)
    r = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "topsecret"},
    )
    assert r.status_code == 200
    assert r.json() == {"content": "cleaned markdown content"}


def test_endpoint_maps_scrape_error_to_502(monkeypatch):
    monkeypatch.setattr(app_module, "CRAWL_SECRET", "topsecret")

    async def fake_scrape(url, timeout_s=25.0):
        raise ScrapeError("render failed")

    monkeypatch.setattr(app_module, "scrape_homepage", fake_scrape)
    r = client.post(
        "/scrape",
        json={"url": "https://example.com"},
        headers={"X-Crawl-Secret": "topsecret"},
    )
    assert r.status_code == 502
    assert "error" in r.json()


def test_health_ok():
    assert client.get("/health").json() == {"ok": True}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_app.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 3: Implement the FastAPI app**

`crawl-service/app.py`:
```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/test_app.py -v`
Expected: PASS (4 passed). (These tests monkeypatch `scrape_homepage`, so no browser launches.)

- [ ] **Step 5: Run the full suite**

Run: `pytest -v`
Expected: PASS (6 passed — Task 1 + Task 2).

- [ ] **Step 6: Commit**

```bash
git add crawl-service/app.py crawl-service/tests/test_app.py
git commit -m "feat(crawl-service): add authenticated POST /scrape endpoint"
```

---

### Task 3: Dockerfile, Railway config, and deploy docs

Package the service so Railway builds Chromium + deps deterministically and serves on `$PORT`. Verified by a local Docker build + `/health` curl (no browser needed for the healthcheck) and an optional real `/scrape`.

**Files:**
- Create: `crawl-service/Dockerfile`
- Create: `crawl-service/.dockerignore`
- Create: `crawl-service/railway.json`
- Create: `crawl-service/.env.example`
- Create: `crawl-service/README.md`

**Interfaces:**
- Produces: a container that runs `uvicorn app:app` on `$PORT`, with `/health` and `/scrape` reachable. Consumed operationally by `generate-icp` in Task 4 via `CRAWL_SERVICE_URL`.

- [ ] **Step 1: Write the Dockerfile**

`crawl-service/Dockerfile`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install --with-deps chromium

COPY . .

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

- [ ] **Step 2: Write the supporting files**

`crawl-service/.dockerignore`:
```
.venv
__pycache__
*.pyc
.pytest_cache
tests
.env
README.md
```

`crawl-service/railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "uvicorn app:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

`crawl-service/.env.example`:
```
# Shared secret checked against the X-Crawl-Secret header. Must match the
# CRAWL_SERVICE_SECRET set on the generate-icp Edge Function.
CRAWL_SERVICE_SECRET=change-me
# Internal render/navigation timeout in seconds (kept under generate-icp's 30s outer budget).
SCRAPE_TIMEOUT_S=25
```

`crawl-service/README.md`:
```markdown
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
```

- [ ] **Step 3: Build the image**

Run (repo root): `docker build -t crawl-service ./crawl-service`
Expected: build completes; the `playwright install --with-deps chromium` layer succeeds.

- [ ] **Step 4: Run and verify `/health`**

```bash
docker run -d --rm --name crawl-svc -e CRAWL_SERVICE_SECRET=test -e PORT=8000 -p 8000:8000 crawl-service
curl -s http://localhost:8000/health
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Verify `/scrape` end-to-end (real render)**

```bash
curl -s -X POST http://localhost:8000/scrape \
  -H "X-Crawl-Secret: test" -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```
Expected: JSON `{"content":"...Example Domain..."}` with non-trivial markdown. Then:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/scrape \
  -H "content-type: application/json" -d '{"url":"https://example.com"}'
```
Expected: `401` (missing secret). Then stop the container: `docker stop crawl-svc`.

- [ ] **Step 6: Commit**

```bash
git add crawl-service/Dockerfile crawl-service/.dockerignore crawl-service/railway.json crawl-service/.env.example crawl-service/README.md
git commit -m "feat(crawl-service): add Dockerfile, Railway config, and deploy docs"
```

---

### Task 4: Point `generate-icp` at crawl-service

Refactor the Edge Function so its request handler is importable (for unit tests), then replace `fetchSiteText`'s plain `fetch` + regex strip with a call to crawl-service. Delete `stripHtml`. All downstream logic is unchanged.

**Files:**
- Create: `supabase/functions/generate-icp/handler.ts`
- Modify: `supabase/functions/generate-icp/index.ts` (replace entire contents)
- Test: `supabase/functions/generate-icp/handler.test.ts`

**Interfaces:**
- Consumes: `callLLMJson` from `../_shared/llm.ts` (unchanged: `callLLMJson<T>({ messages, schema, schemaName, maxTokens?, model? }): Promise<T>`); crawl-service `POST /scrape` (Task 2).
- Produces: `handler(req: Request): Promise<Response>` and `MIN_CONTENT_LENGTH` exported from `handler.ts`. `index.ts` just serves `handler`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/generate-icp/handler.test.ts`:
```typescript
import { assert, assertEquals } from "jsr:@std/assert@1"
import { handler } from "./handler.ts"

function makeReq(body: unknown): Request {
  return new Request("http://localhost/generate-icp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Replace globalThis.fetch; returns a restore function.
function stubFetch(
  fake: (url: string, init?: RequestInit) => Promise<Response>,
): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    fake(String(input), init)) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function setEnv() {
  Deno.env.set("CRAWL_SERVICE_URL", "http://crawl.test")
  Deno.env.set("CRAWL_SERVICE_SECRET", "s")
}

const LONG_CONTENT = "Acme helps revenue teams. ".repeat(30) // > 200 chars

Deno.test("sufficient scraped content → returns ICP", async () => {
  setEnv()
  const restore = stubFetch(async (url) => {
    if (url.endsWith("/scrape")) {
      return new Response(JSON.stringify({ content: LONG_CONTENT }), { status: 200 })
    }
    // LLM call (Bynara /chat/completions)
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              target_roles: ["VP Sales"],
              company_types: ["B2B SaaS"],
              pain_points: ["forecasting"],
              raw_summary: "ok",
            }),
          },
        }],
      }),
      { status: 200 },
    )
  })
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    const data = await res.json()
    assertEquals(res.status, 200)
    assert(!("needs_manual_input" in data))
    assertEquals(data.target_roles, ["VP Sales"])
  } finally {
    restore()
  }
})

Deno.test("too-short scraped content → needs_manual_input", async () => {
  setEnv()
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ content: "short" }), { status: 200 }))
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    assertEquals(await res.json(), { needs_manual_input: true })
  } finally {
    restore()
  }
})

Deno.test("crawl-service failure → needs_manual_input", async () => {
  setEnv()
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ error: "boom" }), { status: 502 }))
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    assertEquals(await res.json(), { needs_manual_input: true })
  } finally {
    restore()
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (repo root): `deno test --allow-env --allow-net supabase/functions/generate-icp/handler.test.ts`
Expected: FAIL — module `./handler.ts` not found (or no export `handler`).

- [ ] **Step 3: Create `handler.ts` with the crawl-service call**

`supabase/functions/generate-icp/handler.ts`:
```typescript
import { callLLMJson } from "../_shared/llm.ts"

export const MIN_CONTENT_LENGTH = 200

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

async function fetchSiteText(url: string): Promise<string> {
  const base = Deno.env.get("CRAWL_SERVICE_URL")
  const secret = Deno.env.get("CRAWL_SERVICE_SECRET")
  if (!base || !secret) {
    console.error("CRAWL_SERVICE_URL or CRAWL_SERVICE_SECRET not configured")
    return ""
  }
  try {
    const res = await fetch(`${base}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawl-Secret": secret,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.error(`crawl-service returned ${res.status}`)
      return ""
    }
    const data = await res.json()
    return typeof data?.content === "string" ? data.content : ""
  } catch (err) {
    console.error(`crawl-service call failed: ${String(err)}`)
    return ""
  }
}

type IcpResult = {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
}

const ICP_SCHEMA = {
  type: "object",
  properties: {
    target_roles: { type: "array", items: { type: "string" } },
    company_types: { type: "array", items: { type: "string" } },
    pain_points: { type: "array", items: { type: "string" } },
    raw_summary: { type: "string" },
  },
  required: ["target_roles", "company_types", "pain_points", "raw_summary"],
  additionalProperties: false,
}

function generateIcp(content: string): Promise<IcpResult> {
  return callLLMJson<IcpResult>({
    schema: ICP_SCHEMA,
    schemaName: "icp",
    messages: [
      {
        role: "user",
        content: `Based on this website/product content, identify the ideal customer profile (ICP): target roles who'd buy this, the types of companies that fit, their pain points this product solves, and a short summary.\n\nContent:\n${content}`,
      },
    ],
  })
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const { website_url, fallback_text } = await req.json()

  let content: string
  if (typeof fallback_text === "string" && fallback_text.trim().length > 0) {
    content = fallback_text.trim()
  } else {
    const scraped = await fetchSiteText(website_url)
    if (scraped.length < MIN_CONTENT_LENGTH) {
      return new Response(JSON.stringify({ needs_manual_input: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      })
    }
    content = scraped
  }

  try {
    const icp = await generateIcp(content)
    return new Response(JSON.stringify(icp), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
}
```

- [ ] **Step 4: Replace `index.ts` with a thin entrypoint**

`supabase/functions/generate-icp/index.ts` (replace entire file):
```typescript
import { handler } from "./handler.ts"

Deno.serve(handler)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-env --allow-net supabase/functions/generate-icp/handler.test.ts`
Expected: PASS (3 passed). (The LLM `BYNARA_API_KEY` is never really used — `globalThis.fetch` is stubbed for both the `/scrape` and `/chat/completions` calls.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-icp/handler.ts supabase/functions/generate-icp/index.ts supabase/functions/generate-icp/handler.test.ts
git commit -m "feat(generate-icp): scrape homepage via crawl-service instead of raw fetch"
```

---

### Task 5: Provision secrets, deploy, and manual end-to-end QA

Wire the shared secret and service URL into both environments, deploy, and confirm the real onboarding flow both succeeds and falls back correctly. This task has no automated tests — it is the spec's "Manual QA end-to-end" gate.

**Files:**
- (No source changes — configuration and verification only.)

**Interfaces:**
- Consumes: the deployed Railway service (Task 3) and the updated Edge Function (Task 4).

- [ ] **Step 1: Generate a shared secret**

Run: `openssl rand -hex 32`
Keep the output — the same value is used in both places below.

- [ ] **Step 2: Deploy crawl-service to Railway**

Create the Railway service from `crawl-service/` (per its README), set env vars `CRAWL_SERVICE_SECRET=<the secret>` and optionally `SCRAPE_TIMEOUT_S=25`, deploy, and copy the public URL (no trailing slash), e.g. `https://crawl-service-production.up.railway.app`.

Verify it's live:
```bash
curl -s https://<railway-url>/health
```
Expected: `{"ok":true}`.

- [ ] **Step 3: Set the Edge Function secrets**

Run (repo root):
```bash
pnpm exec supabase secrets set CRAWL_SERVICE_URL=https://<railway-url> CRAWL_SERVICE_SECRET=<the secret>
```
Expected: `Finished supabase secrets set.`

- [ ] **Step 4: Deploy the Edge Function**

Run: `pnpm exec supabase functions deploy generate-icp`
Expected: deploy succeeds; the function is bundled with `handler.ts` + `index.ts`.

- [ ] **Step 5: Manual QA — happy path**

In the web app, run onboarding against a real marketing site (e.g. a simple SaaS homepage). Confirm: the spinner covers the wait, the flow lands on the **review** step, and `target_roles` / `company_types` / `pain_points` / `raw_summary` are populated sensibly. Save and confirm redirect to `/inbox` with a row in `icps`.

- [ ] **Step 6: Manual QA — fallback path**

Run onboarding against a domain that will fail or return an empty shell (e.g. a parked domain or a made-up unreachable host). Confirm the flow lands on the **manual** step ("We couldn't read your website...") rather than erroring, then confirm the manual-description path still produces a reviewable ICP.

- [ ] **Step 7: Confirm the misconfig log path (optional spot-check)**

Temporarily set a wrong `CRAWL_SERVICE_SECRET` on the Edge Function (or Railway), run onboarding once, and confirm in the function logs (`pnpm exec supabase functions logs generate-icp`) that a `console.error` about the non-2xx crawl-service response appears while the user still sees the manual fallback (no infra error UI). Restore the correct secret afterward.

- [ ] **Step 8: Commit any doc updates**

If the Railway URL or ops notes were captured anywhere trackable (e.g. README), commit them:
```bash
git add crawl-service/README.md
git commit -m "docs(crawl-service): note production deploy wiring"
```

---

## Self-Review

**Spec coverage:**
- §2 Architecture (new `crawl-service`, Python/FastAPI/Crawl4AI, Railway, one `/scrape` endpoint, shared secret, ~20–30s budget) → Tasks 1–3, constraint block.
- §2 `generate-icp` minimal change (`fetchSiteText` → crawl-service call, downstream unchanged, no onboarding/schema change) → Task 4.
- §3 Data flow (invoke → POST /scrape → render homepage → `MIN_CONTENT_LENGTH` gate → `generateIcp` → review/save) → Task 4 handler + Task 5 QA.
- §4 Error handling (any non-2xx/timeout/error → `needs_manual_input`; 401 on secret misconfig treated identically; `console.error`) → Task 4 `fetchSiteText`, Task 2 401, Task 5 Step 7.
- §5 Testing (crawl-service: stable-page extraction + invalid-URL clean error; generate-icp: 3 branches; manual E2E) → Task 1 tests, Task 2 tests, Task 4 tests, Task 5.
- §6 Out of scope (multi-page, Inngest, extension, schema/RLS/UI) → honored; captured in constraints.

**Placeholder scan:** No TBD/"handle errors"/"similar to"/"write tests for the above" — every code and test step contains full content. ✓

**Type consistency:** `scrape_homepage(url, timeout_s)` / `ScrapeError` are defined in Task 1 and consumed unchanged in Task 2's tests and app. `handler` / `MIN_CONTENT_LENGTH` defined in Task 4's `handler.ts` and consumed by `index.ts` and the test. crawl-service response key `content` matches `fetchSiteText`'s `data.content` read. Header `X-Crawl-Secret` consistent across app, curl, and handler. Env var names `CRAWL_SERVICE_URL` / `CRAWL_SERVICE_SECRET` / `SCRAPE_TIMEOUT_S` consistent across Tasks 2–5. ✓
