# Crawl4AI-Powered ICP Generation (Spec A)

**Status:** Approved for implementation planning
**Supersedes:** the scraping step of `2026-07-03-day1-web-app-icp-generation-design.md` (Section 4, steps 4-5) — everything else in that spec (auth, onboarding routing, `icps` schema, review/save UI) is unchanged and still in effect.
**Scope:** Replace the current single-page `fetch()` + regex HTML-strip in the `generate-icp` Edge Function with a homepage scrape performed by a new Crawl4AI-based service. The Chrome extension rebuild (active keyword search, in-extension results list) is a separate spec ("Spec B") and out of scope here — this spec only touches how the ICP gets generated on the web side.

---

## 1. Context

The product's actual intent (clarified after the passive-extension MVP had already been built) is:

1. **Web:** user enters their website domain → an AI-driven scrape reads the site and produces the ideal customer profile (ICP) describing the site's purpose and target audience.
2. **Extension:** user actively searches LinkedIn by keyword; the extension crawls LinkedIn search results in real time and scores each lead against the ICP.

This spec covers only part 1, and only the homepage (multi-page crawling was considered and deliberately deferred — see Section 7).

The current `generate-icp` Edge Function (`supabase/functions/generate-icp/index.ts`) already has the right shape: fetch → strip → LLM → structured ICP → manual-input fallback. The only thing that needs to change is *how the page content is obtained* — swapping a plain `fetch()` + regex strip for a real headless-browser render via [Crawl4AI](https://github.com/unclecode/crawl4ai), which handles JS-rendered sites and produces cleaner extracted content (Crawl4AI's built-in markdown generator strips nav/footer/boilerplate more reliably than regex).

---

## 2. Architecture

A new standalone service, `crawl-service/`, is added to the repo as a sibling of `web/` and `extension/`:

- **Stack:** Python, FastAPI, Crawl4AI (which wraps Playwright for headless rendering).
- **Deployment:** always-on container on **Railway** (Dockerfile + Railway web service). Not an on-demand sandbox — a persistent service keeps latency predictable for the synchronous onboarding flow.
- **Interface:** one endpoint.

```
POST /scrape
headers: X-Crawl-Secret: <shared secret>
body: { "url": "https://example.com" }

200 → { "content": "<cleaned markdown of the homepage>" }
4xx/5xx → { "error": "<reason>" }  (invalid URL, timeout, unreachable, render failure)
```

- Auth between `generate-icp` and `crawl-service` is a shared secret (`CRAWL_SERVICE_SECRET`), set as both a Supabase Edge Function secret and a Railway environment variable. Not user-facing; this service is never called directly by the browser.
- Request timeout budget: ~20-30s end-to-end (crawl-service internally bounds its own render/navigation timeout so it always responds within that window rather than hanging).

The `generate-icp` Edge Function changes minimally:

- `fetchSiteText(url)` is replaced with a call to `crawl-service`'s `/scrape` endpoint.
- Everything downstream is unchanged: `MIN_CONTENT_LENGTH` check, `ICP_SCHEMA`, `generateIcp()` LLM call (via the shared Bynara `callLLMJson` helper), `needs_manual_input` response shape.
- No changes to `web/app/onboarding/onboarding-flow.tsx` — it already does a synchronous `supabase.functions.invoke()` call with a loading state, which is exactly the UX this design keeps.
- No changes to the `icps` table schema.

---

## 3. Data Flow

1. User submits their website URL on the onboarding page (existing UI, unchanged).
2. `supabase.functions.invoke("generate-icp", { body: { website_url } })`.
3. `generate-icp` POSTs `{ url: website_url }` to `crawl-service` on Railway, with the shared-secret header.
4. `crawl-service` launches a headless browser via Crawl4AI, navigates to the homepage only (no link-following — see Section 7), waits for render, and returns cleaned markdown content.
5. `generate-icp` checks `content.length >= MIN_CONTENT_LENGTH`:
   - Too short, or the crawl-service call failed/timed out/errored → return `{ needs_manual_input: true }` (same contract as today). The onboarding UI already shows the manual-description textarea in this case.
   - Sufficient → pass content into the existing `generateIcp()` LLM call, producing `{ target_roles, company_types, pain_points, raw_summary }`.
6. Response returns to the onboarding UI. User reviews/edits fields on the existing review screen, saves → upserts into `icps` — unchanged.

---

## 4. Error Handling

- **crawl-service unreachable, times out, or returns non-2xx** → `generate-icp` catches this and folds it into the same `needs_manual_input` path used for "content too short." No new UI error state is introduced.
- **JS-heavy / bot-protected sites** → this is exactly what Crawl4AI/Playwright improves over the old plain `fetch()`; expect fewer fallback triggers than today, not more.
- **Genuinely dead URL** (DNS failure, 404) → crawl-service returns an error response; same fallback path as above.
- **Malformed URL input** → still caught client-side by `<Input type="url" required>`, plus a try/catch in crawl-service around navigation.
- **Shared-secret misconfiguration** → crawl-service returns 401; `generate-icp` treats any non-2xx response identically (falls back to manual input) rather than surfacing an infra-specific error to the end user. A `console.error` log on the Edge Function side is sufficient for us to notice a misconfig without building user-facing infra-error UI.

---

## 5. Testing

- **crawl-service:** integration tests against a couple of known stable pages (a static fixture and a real simple site) confirming markdown extraction returns non-trivial content; one test for an invalid/unreachable URL confirming a clean error response rather than a hang or crash.
- **generate-icp:** unit tests mocking the crawl-service HTTP call across three branches — success with sufficient content, success with too-little content, and crawl-service failure — verifying the function lands on `needs_manual_input` correctly for the latter two.
- **Manual QA end-to-end:** run onboarding against a real marketing site and confirm the spinner covers the wait and ICP fields populate sensibly; point it at a domain that will fail or return an empty shell and confirm the manual fallback triggers correctly.

---

## 6. Explicitly Out of Scope

- **Multi-page / multi-depth crawling.** Deliberately deferred — homepage only for now. If deeper crawling (header/footer/section links, or recursive depth) is needed later, it's a follow-up change to `crawl-service`'s `/scrape` endpoint (e.g. an optional `depth` or `max_pages` param), not a new spec.
- **Background job orchestration (e.g. Inngest).** Not needed — this is a single synchronous HTTP round-trip within one Edge Function invocation, bounded by a fixed timeout. Revisit only if a future spec introduces genuinely long-running or multi-step async work (e.g. Spec B's LinkedIn crawl, or later multi-page site crawling).
- **The Chrome extension rebuild** (active keyword search, LinkedIn search crawling, in-extension results list with live scoring) — this is "Spec B," a separate brainstorming pass, since it's only loosely coupled to this spec (it just reads the finished `icps` row).
- **Changes to the `icps` table schema, RLS policies, or the onboarding review/edit UI** — all unchanged from the existing implementation.
