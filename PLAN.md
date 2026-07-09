# LinkedIn Lead Gen Tool — Build Plan

**Timeline:** 5 days (original) — extended with the autonomous search agent (Spec B)
**Stack:** Next.js + Supabase (Postgres/Auth/Realtime/Edge Functions, Deno runtime) + Chrome Extension (WXT + React + Tailwind) + OpenRouter (LLM, `deepseek/deepseek-v4-flash`) + a hosted Crawl4AI Docker server (Railway, used only for onboarding ICP generation)

---

## 1. Product Summary

A LinkedIn lead generation tool for founders, agencies, and solo operators doing outbound sales.

- User adds their website URL → a hosted Crawl4AI scrape + an LLM call (OpenRouter, `deepseek/deepseek-v4-flash`) generates their ICP (target role, company type, pain points)
- User installs a Chrome extension and pairs it with the web app (short-lived pairing code → long-lived device token, stored in `chrome.storage.local`)
- User browses LinkedIn normally in their own browser; a content script reads what's already rendered on screen (feed posts, search results, profiles) and scores it against the ICP in real time — **or** opens the extension's Chrome Side Panel on a LinkedIn tab, types a plain-English request (e.g. "Find me CEOs of ecommerce startups"), and the extension autonomously drives that same foreground tab through a LinkedIn people-search at human-like pacing, scoring results as they render (see the "autonomous search agent" in Section 4)
- Strong matches (name, company, post context, LinkedIn URL, score) sync instantly into a lead inbox in the web app via Supabase Realtime
- User reaches out manually with full context in front of them

**Explicitly not building:** LinkedIn OAuth/account connection, multi-tab or background/headless crawling, proxy-based scraping infrastructure, opening individual profile pages during an autonomous run, funding-stage/company-level targeting. The autonomous search agent still only ever drives the single foreground tab the user already has open, with hard session caps and randomized pacing — see Section 6/7 for why, and `docs/superpowers/specs/2026-07-09-linkedin-search-agent-design.md` for the full design.

---

## 2. Architecture

**Chrome Extension** (WXT + React + TS) ←→ **Supabase** ←→ **Next.js Web App**

- **Chrome Extension** — content script (passive `MutationObserver` scan + autonomous agent loop), Side Panel (NL query UI), popup (pairing)
- **Supabase** — Postgres, Auth (shared with the web app), Edge Functions (Deno) which call out to OpenRouter for LLM calls, Realtime
- **Next.js Web App** — ICP onboarding, lead inbox (realtime), `/settings` (pairing)

**Data flow per scored item:**
1. A lead candidate is surfaced one of two ways: (a) passively — the content script's `MutationObserver` notices a profile card or post already rendered on the page as the user scrolls/browses normally, or (b) via the autonomous agent — the user types a request in the Side Panel, an edge function (`parse-search-query`) turns it + their ICP into LinkedIn search parameters, the extension navigates the user's own active LinkedIn tab to that search, and drives scroll/pagination itself at randomized pacing with hard session caps (max leads / max minutes). Neither path ever opens a new tab or an individual profile page.
2. Extracts: name, headline, company, post text, LinkedIn URL
3. POSTs to Supabase Edge Function `score-lead` with `{ profile_data, device_token }` — the extension never asserts its own `user_id`; the function resolves it server-side from `extension_pairings.device_token`
4. Edge Function skips re-scoring/re-inserting if a `leads` row already exists for this `user_id` + `linkedin_url` (dedup); otherwise fetches the user's ICP from `icps`, calls the LLM via OpenRouter (`deepseek/deepseek-v4-flash`) with structured JSON-schema output (score 0–100 + reasoning), inserts into `leads`
5. Supabase Realtime broadcasts the insert → web app inbox updates instantly, no polling
6. Edge Function also returns the score synchronously to the content script, which badges the profile/post inline on LinkedIn

---

## 3. Supabase Schema

```sql
-- users: handled by Supabase Auth

create table icps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  website_url text not null,
  target_roles text[],
  company_types text[],
  pain_points text[],
  raw_summary text,
  created_at timestamptz default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text,
  company text,
  role text,
  linkedin_url text,
  post_context text,
  match_score int,
  match_reasons text[],
  status text default 'new', -- new / contacted / ignored
  source text default 'extension', -- profile / post / search_result
  created_at timestamptz default now()
);

create table extension_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  pairing_code text unique not null,
  device_token text unique,
  expires_at timestamptz not null,
  paired_at timestamptz,
  created_at timestamptz default now()
);
```

`scan_sessions` from the original plan was never built — dropped as unneeded; run-level state for the autonomous agent (query, lead count, caps) lives in `chrome.storage.local` on the extension side instead, not in Postgres.

`extension_pairings` is a two-token handshake, not a single token: the web app's `create-pairing` function mints a short-lived (10 min), single-use `pairing_code`; the extension exchanges it via `pair-extension` for a long-lived `device_token`, which is what every subsequent extension request authenticates with (never a Supabase JWT — see Section 6).

Enable Row Level Security on all tables, scoped to `auth.uid() = user_id`.

---

## 4. Extension Approach — Passive Scan (shipped) + Autonomous Search Agent (Spec B)

### Baseline: passive scan — shipped, Days 3–4
- User browses LinkedIn normally — searches their own keyword, scrolls, opens profiles
- Content script uses a `MutationObserver` on the feed/results container to detect newly rendered nodes
- No `chrome.tabs.create`, no programmatic navigation — extension is a passenger, not a driver

### Autonomous search agent — Spec B (`docs/superpowers/specs/2026-07-09-linkedin-search-agent-design.md`)
What the original plan called an "optional stretch" became a fully designed, real feature — the extension can now drive the search itself instead of waiting for the user to scroll:

- Chrome **Side Panel** (`chrome.sidePanel`), enabled only while the active tab is on `linkedin.com`. The user types a plain-English request; a new device-token-authenticated edge function, `parse-search-query`, turns it (plus the user's ICP) into LinkedIn search parameters (`title` for canonical job titles, free-text `keywords` for described personas LinkedIn has no filter for).
- The extension navigates the user's own **active foreground tab** to that search — never a new tab, never background/headless activity — and drives scroll/pagination itself.
- **Randomized pacing** (no fixed-interval loops) and **hard session caps** (default: stop after 100 leads or 20 minutes, whichever first).
- Auto-pauses if the tab loses focus; stops itself on a LinkedIn commercial-search-limit banner, on several consecutive rounds with nothing new, or if the tab closes mid-run.
- Scores off search-results-list cards only — never opens individual profile pages, to keep request volume low.

**Explicitly out of scope (both modes):** autonomous multi-tab crawling, headless browser automation, opening new tabs, proxy-based IP rotation to evade detection, opening individual profile pages during a run, funding-stage/company-level targeting. These shift real ban risk onto the user's LinkedIn account regardless of how "disconnected" the platform stays from LinkedIn — see Section 6.

---

## 5. Extension Framework: WXT

- File-based entrypoints (`entrypoints/popup`, `entrypoints/sidepanel`, `entrypoints/linkedin.content.ts`, `entrypoints/background.ts`) — WXT auto-generates the manifest
- Vite-based — fast HMR, small bundle size
- Cross-browser build support (Chrome first, Firefox/Safari later at no extra architectural cost)
- React + TypeScript + Tailwind for popup/options UI

```
extension/
├── entrypoints/
│   ├── popup/                 # pairing status, pair/unpair
│   ├── sidepanel/              # autonomous agent UI: NL query, start/stop, live progress
│   ├── linkedin.content.ts      # DOM reader + MutationObserver (passive) + agent loop (autonomous), badge injection
│   └── background.ts             # per-tab side panel enable/disable, run orchestration (parse query, navigate tab, run-state)
├── lib/
│   ├── pairing.ts                 # device token storage + pairing-code exchange
│   ├── extract.ts                  # LinkedIn DOM → LeadCandidate (best-effort, fail-soft selectors)
│   ├── score.ts                     # calls score-lead
│   ├── query.ts                      # calls parse-search-query, builds the LinkedIn search URL
│   ├── run.ts                         # autonomous-run state over chrome.storage.local
│   └── messages.ts                     # shared runtime message types (sidebar ↔ background ↔ content script)
├── public/
└── wxt.config.ts
```

No `options/` page exists — settings/pairing management lives on the web app's `/settings` page instead.

---

## 6. Extension ↔ Web App Pairing/Auth

**No LinkedIn OAuth. No LinkedIn credentials touch your servers.** The extension only ever needs to know which of *your* platform's users it belongs to.

1. User logs into the web app normally (Supabase Auth)
2. Web app's `/settings` page calls `create-pairing` (authenticated by the user's Supabase JWT), which mints a short-lived (10 min), single-use `pairing_code` (8-char, unambiguous alphabet) in `extension_pairings`
3. Extension popup has a "Pair" field — user pastes the code
4. Extension POSTs the code to the public `pair-extension` Edge Function (no Supabase JWT — the extension never holds one), which validates it and returns a long-lived, opaque `device_token`; the extension stores it in `chrome.storage.local` and uses it to authenticate every future `score-lead`/`parse-search-query` request. The client never asserts its own `user_id` — the backend always resolves it server-side from `extension_pairings.device_token`.
5. Pairing can be revoked from the web app's `/settings` page at any time (deletes the row; the device token stops resolving to a `user_id`, so authenticated requests start failing)

This keeps the LinkedIn session cookie entirely inside the user's own Chrome profile — the extension reads the rendered DOM, not the cookie itself. Only extracted lead data (name, company, post text, URL) ever reaches your backend.

---

## 7. Why No Proxies / No Autonomous Crawling (for reference)

Noting this here so it doesn't get re-litigated mid-build:

- A proxy changes the IP address LinkedIn sees a request come from — nothing else. It does not remove, replace, or relocate the session cookie, which must stay in the user's browser for them to be logged in at all.
- LinkedIn's detection is layered: IP reputation is one signal, but behavioral fingerprinting (scroll velocity, click timing, request pacing) and account-history risk scoring are separate signals a proxy has no effect on.
- The account at risk is the *user's* LinkedIn account, not your platform's data — this is true regardless of whether your servers ever touch LinkedIn credentials, because LinkedIn evaluates the account doing the browsing, not who it's "connected to."
- Building proxy-assisted or headless autonomous crawling is an ongoing adversarial engineering commitment (LinkedIn actively patches detection), not a one-time build — better to spend the 5 days and beyond on ICP/scoring quality instead.

---

## 8. 5-Day Build Plan

### Day 1 — Web app skeleton + ICP generation ✅ done (later swapped to Crawl4AI, see below)
- Next.js + Supabase Auth scaffolded
- Onboarding flow: URL input → Edge Function fetches site content → LLM generates structured ICP JSON → user reviews/edits → saves to `icps`

### Day 2 — Lead inbox UI + scoring Edge Function ✅ done
- `leads` table + inbox UI (list, filter by score, status toggle: new/contacted/ignored)
- `/functions/score-lead`: takes scraped profile/post text + ICP, returns score + reasoning via LLM structured output
- Test directly with curl/Postman before touching the extension

### Day 3 — Extension MVP (WXT) ✅ done
- `wxt init`, React + Tailwind, manifest permissions for `linkedin.com/*`
- Content script: selectors for profile pages and feed posts, `MutationObserver` for passive detection
- Pairing flow: two-token handshake (pairing code → device token), `chrome.storage.local`

### Day 4 — Wire extension to backend + inline UI ✅ done
- POST scraped data to `score-lead` (device-token authenticated), render inline score badge on LinkedIn profiles/posts
- Leads appear in the web inbox via a Supabase Realtime subscription filtered to `user_id`

### Interlude — Crawl4AI-powered ICP generation ✅ done
- Swapped the Day 1 plain `fetch()` + regex site scrape for a real headless-browser render, so JS-heavy marketing sites produce usable ICPs. `generate-icp` now calls a hosted, generic Crawl4AI Docker server's `/md` endpoint (Bearer-token authenticated) — not a custom service built in this repo (an earlier custom `crawl-service/` wrapper was built and tested but never deployed, and was removed once this path proved out; see `docs/superpowers/specs/2026-07-07-crawl4ai-icp-generation-design.md`).
- LLM provider swapped from a Bynara-router / direct-OpenAI setup to **OpenRouter** (`deepseek/deepseek-v4-flash`), via the shared `_shared/llm.ts` helper — same OpenAI-compatible `callLLMJson` signature, provider underneath changed.

### Day 5 (extended) — Autonomous search agent (Spec B) — in progress
- What was originally scoped as an "optional stretch" (foreground auto-scroll) became a full feature: a Chrome Side Panel where the user types a plain-English request and the extension autonomously drives their own LinkedIn search, still foreground-only and capped/paced. See Section 4 and `docs/superpowers/specs/2026-07-09-linkedin-search-agent-design.md` / `docs/superpowers/plans/2026-07-09-linkedin-search-agent.md` for the full design and task breakdown.

### Ship — not yet done
- Rate limiting / debounce on rapid scroll to avoid hammering the Edge Function (done for the passive scan; the autonomous agent has its own pacing/caps)
- Graceful failure when LinkedIn's DOM selectors break (expect this — don't crash the badge UI)
- Chrome Web Store submission (review takes days — submit even if imperfect)
- Landing page copy, demo video, build-in-public post

---

## 9. Known Risk Areas to Watch

- **LinkedIn DOM instability** — selectors will break periodically; build the content script to fail silently and log rather than crash
- **Ban risk is behavioral, not architectural** — no amount of "not connecting the account" removes it; passive scan keeps this close to zero, the autonomous search agent (foreground-only, paced, capped) raises it somewhat, full multi-tab/background automation would raise it significantly — which is exactly why that's excluded (Section 7)
- **Pairing code / device token expiry and revocation** — make sure a revoked pairing immediately stops the extension from posting data (score-lead resolves `user_id` from `extension_pairings.device_token` on every request, so a deleted row fails closed)
- **Scope creep on Day 3** — if behind schedule, cut to profile-page scanning only and skip feed-post scanning; profiles are more DOM-stable than the infinite-scroll feed