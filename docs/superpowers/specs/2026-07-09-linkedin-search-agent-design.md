# Autonomous LinkedIn Search Agent (Spec B)

**Status:** Approved for implementation planning
**Builds on:** Day 3 (`2026-07-06-day3-extension-pairing.md`) and Day 4 (`2026-07-07-day4-wire-extension-realtime.md`) — pairing, passive content-script scanning, `score-lead`, and the realtime inbox all stay as-is and are reused unchanged.
**Referenced as:** "Spec B" in `2026-07-07-crawl4ai-icp-generation-design.md` Section 6, which deferred "the Chrome extension rebuild (active keyword search, LinkedIn search crawling, in-extension results list with live scoring)" to a separate spec. This is that spec.
**Scope:** Add a natural-language-driven, autonomous search run to the extension — a Chrome Side Panel sidebar where the user types a request (e.g. "Find me CEOs of ecommerce startups"), and the extension drives the user's own active LinkedIn tab through a search, scoring results against their ICP in real time. Company-level and funding-stage targeting (e.g. "recently raised Series A") is explicitly out of scope — see Section 7.

---

## 1. Context

The existing extension (Days 3–4) is **passive only**: it watches whatever the user manually scrolls into view on LinkedIn and scores it. It never searches or navigates on its own. That was a deliberate initial choice (`PLAN.md` Section 6/7: LinkedIn's detection is behavioral, not IP-based, so any automated navigation trades directly against the user's own account's ban risk).

The user now wants the extension to be a **directed agent**: given a plain-English description of who to find (roles like CEO, Founder, Product Manager, or described personas like "ecomm shop owner"), it should construct and run a LinkedIn search itself, in the user's active browser tab, and surface high-scoring matches without the user manually scrolling.

This spec keeps the safety posture from the original plan — foreground-tab only, no new tabs, no background activity, randomized pacing, hard session caps — while adding real autonomy on top: the agent chooses the search, drives the scroll/pagination, and reports progress live.

**Decisions carried in from brainstorming:**
- Company- and funding-stage targeting ("recently raised Series A") is deferred — no funding-data API integration in this spec. Only person-level role targeting is in scope.
- The agent scores off search-results-list cards only; it does not open individual profile pages. This keeps request volume roughly one page load per ~10 results (LinkedIn's own pagination) rather than one per candidate.
- LinkedIn's free-account commercial search limits are a real, unavoidable ceiling — the design plans around dozens-to-~100 leads/day, not unlimited throughput.

---

## 2. Architecture

Three extension contexts coordinate a "run," plus one new Edge Function:

```
┌─────────────────┐   START_RUN    ┌──────────────────┐   chrome.tabs.update   ┌────────────────────┐
│  Sidebar (React)  │──────────────▶│  Background        │───────────────────────▶│  LinkedIn tab         │
│  entrypoints/       │                │  (service worker)   │                          │  (content script)      │
│  sidepanel/           │◀───────────────│  entrypoints/         │◀─────────────────────────│  linkedin.content.ts    │
└─────────────────┘   PROGRESS      │  background.ts       │      PROGRESS via        └────────────────────┘
                                       └──────────────────┘      chrome.runtime
                                                │
                                                ▼
                                    supabase/functions/
                                    parse-search-query
                                    (device-token auth,
                                     fetches ICP, LLM call)
```

- **Sidebar** (`extension/entrypoints/sidepanel/`): Chrome's native Side Panel API, opened by clicking the extension icon. Shows pairing status (reuses existing `lib/pairing.ts`), a query input, Start/Stop controls, and live run progress (leads found, elapsed time, last status message).
- **Background** (`extension/entrypoints/background.ts`, currently a stub — gains real logic): tracks the active tab's URL to enable/disable the side panel per-tab (`chrome.sidePanel.setOptions`) so it only activates on `linkedin.com`; owns run orchestration — calls `parse-search-query`, builds the LinkedIn search URL, navigates the tab, and relays `PROGRESS`/`STOPPED` messages between the content script and sidebar.
- **Content script** (`extension/entrypoints/linkedin.content.ts`, extended): gains an **agent mode** alongside the existing passive scan. When a run is active (checked via `chrome.storage.local`), it drives scroll/pagination on the search-results page, reusing the existing `extractFromNode` (`lib/extract.ts`) and `scoreLead` (`lib/score.ts`) — no duplication of extraction or scoring logic.
- **New Edge Function** `supabase/functions/parse-search-query`: same auth pattern as `score-lead` (device token → `extension_pairings` → `user_id`, not a Supabase JWT — the extension never holds one). Fetches the user's `icps` row, sends the NL query + ICP to the LLM via the existing `_shared` `callLLMJson` helper, returns structured search parameters.
- **Manifest changes** (`extension/wxt.config.ts`): add the `sidePanel` permission, a `side_panel.default_path` pointing at the new sidepanel entrypoint, and a `tabs` permission (background needs to read/update the active tab's URL — not currently granted). `storage` and the `*://*.linkedin.com/*` host permission are unchanged.

---

## 3. Data Flow

1. User opens LinkedIn; background detects the tab and enables the side panel for it (`chrome.sidePanel.setOptions({ tabId, enabled: true, path: "sidepanel.html" })`). On any other site the panel stays disabled — clicking the icon does nothing, satisfying "auto-detect if LinkedIn is open."
2. User clicks the icon → side panel opens. If unpaired, shows the existing pairing UI first. If no ICP exists yet, shows a prompt linking to onboarding instead of a query box.
3. User types a query (e.g. "Product managers at fintech companies") and clicks Start. Sidebar sends `{ type: "START_RUN", query }` to background via `chrome.runtime.sendMessage`.
4. Background calls `parse-search-query` with the device token and query. The function resolves `user_id`, loads the ICP, and returns structured params:
   ```json
   { "title": "Product Manager", "keywords": "fintech OR payments", "location": null }
   ```
   For described personas (no canonical LinkedIn title), `title` comes back `null` and `keywords` carries the full search burden (e.g. "ecommerce OR shopify OR DTC" combined with "founder OR owner").
5. Background builds the LinkedIn people-search URL from these params (client-side URL construction, not server-side — kept simple and testable) and navigates the active tab via `chrome.tabs.update`. It writes run state to `chrome.storage.local` under `glint_run`: `{ active: true, tabId, query, startedAt, leadCount: 0, cap: { maxLeads: 100, maxMinutes: 20 } }`.
6. The content script, on load (or on detecting `glint_run.active` change), recognizes it's on a LinkedIn search-results URL with an active run for its tab and enters the **agent loop**:
   - Extract + score visible cards (existing `extractFromNode` / `scoreLead`, existing dedup via `seen` set keyed on `linkedin_url`, plus a check against already-known `leads` rows so repeat queries don't reprocess prior finds).
   - Badge high scorers inline (existing `injectBadge`) and let the existing realtime pipeline stream them to the web inbox — **unchanged**.
   - After scoring the visible batch, advance: scroll and/or click LinkedIn's own "Next" pagination (whichever the current UI exposes), waiting a **randomized 3–8s delay** before the next batch — no fixed-interval loop.
   - After each batch, increment `glint_run.leadCount` and post a `PROGRESS` message the sidebar displays live.
7. **Stop conditions**, checked every cycle: `leadCount >= cap.maxLeads`, elapsed time `>= cap.maxMinutes`, the tab loses focus (`document.visibilitychange`), the user clicks Stop in the sidebar (posts `{ type: "STOP_RUN" }`, background sets `glint_run.active = false`), or a LinkedIn commercial-search-limit banner is detected in the DOM. On any of these, the loop exits and posts a final `STOPPED` message with a reason string for the sidebar to display.

---

## 4. Error Handling

- **`parse-search-query` fails** (LLM error, no ICP, invalid device token) → background posts an error `PROGRESS` message; sidebar shows the error inline with a retry button; no navigation happens.
- **LinkedIn commercial search-limit reached** → content script detects the limit banner text, stops the run immediately, reason surfaces as "LinkedIn search limit reached — try again later" in the sidebar. This is treated as an expected, not exceptional, stop condition.
- **Selectors return zero candidates across several consecutive scroll/paginate cycles** → stop early with "No results detected — LinkedIn's layout may have changed," rather than looping indefinitely on a broken selector. Matches the existing fail-soft philosophy in `extract.ts`.
- **Tab closed or navigated away mid-run** → background's tab-removal/update listeners clear `glint_run`, content script has nothing left to report into.
- **Not paired / no ICP** → sidebar blocks Start and shows the relevant setup step instead (pairing flow or onboarding link), consistent with today's popup behavior.

---

## 5. Testing

Consistent with this repo's existing convention (no automated suite for the extension — Days 3/4 verified manually):

- `parse-search-query`: manual `curl` tests with a real device token — canonical-title query, persona-keyword query, missing ICP, invalid token (mirrors `score-lead`'s verification style).
- End-to-end manual run: pair the extension, save an ICP, open LinkedIn, start a run for a canonical-title query and a persona query, confirm the tab navigates, cards get scored/badged, progress updates live in the sidebar, leads appear in the web inbox in realtime, and Stop halts the loop immediately.
- Cap verification: set a low `maxLeads` temporarily and confirm the run stops on its own at the cap with the correct reason shown.
- Confirm the side panel is disabled (icon click does nothing) on a non-LinkedIn tab, and enables within one tab-update cycle after navigating to LinkedIn.

---

## 6. Accuracy & Limitations (carried from brainstorming — keep visible to the user in the sidebar)

- **Search targeting accuracy** is high for canonical titles (CEO, Founder, Product Manager — real entries in LinkedIn's title taxonomy) and lower for described personas ("ecomm shop owner"), which rely on keyword guessing and produce more false positives for the scoring step to filter.
- **Extracted field accuracy** reflects self-reported, possibly stale LinkedIn data (e.g. a headline listing a role the person has since left) — nothing is cross-verified.
- **Scoring accuracy** is LLM judgment against the ICP text from card-level data only (headline/company/location) — a probabilistic first-pass filter, not a verified guarantee.
- This should be surfaced as a strong pre-filter that saves manual scrolling, not a source of guaranteed-accurate leads — the user should still glance at top scores before reaching out.

---

## 7. Explicitly Out of Scope

- **Funding-stage / company-level targeting** ("recently raised Series A," etc.) — no SEC EDGAR, GDELT, news-scraping, or Crunchbase integration in this spec. Discussed and deliberately deferred during brainstorming; a future spec if needed.
- **LinkedIn Sales Navigator support** — this spec targets standard LinkedIn people search only.
- **Opening individual profile pages during a run** — scoring works off search-results cards only; decided during brainstorming to keep request volume low.
- **Multi-tab or background/headless crawling** — the run only ever drives the single active foreground tab the user already has open, matching the original plan's ban-risk stance.
- **Firefox/Safari packaging** — Chrome only, matching the existing extension scope.
- **Changes to `score-lead`, the pairing system, badge rendering, or the realtime inbox subscription** — all reused exactly as built in Days 3–4.
