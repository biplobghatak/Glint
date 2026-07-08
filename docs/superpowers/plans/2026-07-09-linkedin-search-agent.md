# Autonomous LinkedIn Search Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the sidebar-driven autonomous LinkedIn search agent from `docs/superpowers/specs/2026-07-09-linkedin-search-agent-design.md` (Spec B) — a Chrome Side Panel where the user types a plain-English request, the extension parses it into LinkedIn search terms, drives the user's own active LinkedIn tab through the search at human-like pacing, and scores/badges/streams results exactly like the existing passive pipeline.

**Architecture:** Three extension contexts (sidebar, background service worker, content script) coordinate a "run" via `chrome.runtime` messages and a `chrome.storage.local` run-state record. A new device-token-authenticated Edge Function, `parse-search-query`, turns the NL request + the user's ICP into structured LinkedIn search parameters via the existing OpenRouter-backed `callLLMJson` helper. All existing pairing, extraction, scoring, badge, and realtime-inbox code is reused unchanged.

**Tech Stack:** WXT (React + TS) extension, Chrome MV3 Side Panel API, Supabase Edge Functions (Deno), the shared `_shared/llm.ts` OpenRouter helper.

All file paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **Foreground tab only.** The run drives the single active LinkedIn tab the user already has open — no `chrome.tabs.create`, no background/headless activity.
- **Search-results-list only.** The agent never opens individual profile pages; it scores off search-results cards, same data shape the existing passive scan already extracts.
- **Randomized pacing, no fixed-interval loops.** Delays between actions are randomized ranges, not constants.
- **Hard session caps.** A run stops on its own at `maxLeads` (default 100) or `maxMinutes` (default 20), whichever comes first — configurable constants, not user-facing settings in this plan.
- **Chrome only.** The Side Panel API has no Firefox equivalent; this plan does not touch `pnpm --dir extension build:firefox`.
- **Person-level role targeting only.** No funding-data or company-lookup integration — explicitly out of scope per the spec.
- **Reuse, don't duplicate.** `extractFromNode` (`lib/extract.ts`), `scoreLead` (`lib/score.ts`), `getDeviceToken`/`pair` (`lib/pairing.ts`), and the existing badge-injection styling are reused as-is.
- **No automated test suite** — manual verification via `curl` and the browser, matching the convention from Days 1–4.
- **Secrets stay in Edge Function env files** (`supabase/functions/**/.env`, gitignored). The extension ships only the Supabase URL and anon key.
- **LLM calls go through OpenRouter** (`_shared/llm.ts`, `OPENROUTER_API_KEY`/`OPENROUTER_BASE_URL`, default model `deepseek/deepseek-v4-flash`) — already wired; no provider changes needed in this plan.

## Notes on Unverified Assumptions

These are flagged explicitly rather than silently assumed — confirm during the listed task's verification step, and adjust the code if reality differs:

- **OpenRouter structured-output compatibility.** `deepseek/deepseek-v4-flash` via OpenRouter has not been empirically confirmed to support OpenAI-style strict `response_format: json_schema`. Task 1's verification is the first real test of this against a new endpoint; if it fails, the fallback is dropping `strict: true` in `_shared/llm.ts` or switching to `response_format: { type: "json_object" }` with a schema description in the prompt instead — but don't make that change speculatively before seeing a real failure.
- **LinkedIn's "Next" pagination selector** (`button[aria-label="Next"]`) is a best-effort guess, consistent with how `lib/extract.ts` already treats every LinkedIn selector as unstable. Task 4's manual verification against live LinkedIn markup is the first real confirmation; update the selector there if it doesn't match.
- **`chrome.sidePanel` types** require `@types/chrome`, which isn't currently a dependency — added explicitly in Task 2.

---

### Task 1: Backend — `parse-search-query` Edge Function & lead dedup in `score-lead`

**Files:**
- Create: `supabase/functions/parse-search-query/index.ts`
- Modify: `supabase/config.toml` (register the new function with `verify_jwt = false`)
- Modify: `supabase/functions/score-lead/index.ts` (skip re-scoring/re-inserting a lead already on file for this user + `linkedin_url`)

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` (via `_shared/llm.ts`'s `callLLMJson`), the `extension_pairings` and `icps` tables (same lookups `score-lead` already does).
- Produces: `POST { device_token: string, query: string }` → `200 { title: string, keywords: string, location: string }` (empty string means "not applicable" for that field — never `null`, to keep the LLM JSON schema simple). `400 { error: "missing_fields" }`, `401 { error: "unpaired" }`, `404 { error: "no_icp" }`, `502 { error: string }` on LLM failure. This is what `extension/lib/query.ts` (Task 3) calls.

- [ ] **Step 1: Scaffold the function**

Run (repo root): `pnpm exec supabase functions new parse-search-query`
Expected: creates `supabase/functions/parse-search-query/` with a stub `index.ts`, `deno.json`, `.npmrc`.

- [ ] **Step 2: Replace with the implementation**

`supabase/functions/parse-search-query/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
  raw_summary: string | null
}

type ParsedQuery = {
  title: string
  keywords: string
  location: string
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    keywords: { type: "string" },
    location: { type: "string" },
  },
  required: ["title", "keywords", "location"],
  additionalProperties: false,
}

function parsePrompt(query: string, icp: Icp): string {
  return [
    "You convert a seller's natural-language request into LinkedIn people-search parameters.",
    "LinkedIn search supports two fields: an exact job `title` filter, and a free-text `keywords` string.",
    'Only put a value in `title` if the request names a canonical LinkedIn job title (e.g. "CEO", "Founder", "Product Manager"). Leave `title` as an empty string if the request describes a persona rather than a real title (e.g. "ecomm shop owner") — put that in `keywords` instead, as an OR-combined phrase (e.g. "ecommerce OR shopify OR DTC" combined with "founder OR owner").',
    "Extract a `location` if one is mentioned in the request, otherwise leave it as an empty string.",
    "Use the seller's ICP below as extra context to sharpen `keywords`, but the request itself is the primary source of truth for who to search for.",
    "",
    "Request:",
    query,
    "",
    "Seller ICP:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Summary: ${icp.raw_summary ?? "n/a"}`,
  ].join("\n")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { query?: string; device_token?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { query, device_token } = body
  if (!device_token || !query || !query.trim()) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: pairing } = await supabase
    .from("extension_pairings")
    .select("user_id")
    .eq("device_token", device_token)
    .maybeSingle()

  if (!pairing) {
    return new Response(JSON.stringify({ error: "unpaired" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  const user_id = pairing.user_id

  const { data: icp, error: icpError } = await supabase
    .from("icps")
    .select("target_roles, company_types, pain_points, raw_summary")
    .eq("user_id", user_id)
    .maybeSingle()

  if (icpError) {
    return new Response(JSON.stringify({ error: String(icpError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
  if (!icp) {
    return new Response(JSON.stringify({ error: "no_icp" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  try {
    const parsed = await callLLMJson<ParsedQuery>({
      schema: QUERY_SCHEMA,
      schemaName: "search_query",
      maxTokens: 256,
      messages: [{ role: "user", content: parsePrompt(query.trim(), icp as Icp) }],
    })
    return new Response(JSON.stringify(parsed), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
})
```

- [ ] **Step 3: Register the function with `verify_jwt = false`**

In `supabase/config.toml`, after the existing `[functions.pair-extension]` block, add:

```toml
[functions.parse-search-query]
enabled = true
verify_jwt = false
import_map = "./functions/parse-search-query/deno.json"
entrypoint = "./functions/parse-search-query/index.ts"
```

(Same reasoning as `score-lead`/`pair-extension`: the extension authenticates with a device token, not a Supabase JWT.)

- [ ] **Step 4: Verify the no-credits-needed paths**

```bash
pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env
```
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/parse-search-query" \
  -H "Content-Type: application/json" -d '{"device_token":"bogus"}'
```
Expected: `HTTP/1.1 400`, `{"error":"missing_fields"}` (no query).
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/parse-search-query" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"bogus","query":"Find me CEOs of ecommerce startups"}'
```
Expected: `HTTP/1.1 401`, `{"error":"unpaired"}`.

With a real device token from a paired test account that has no ICP saved yet:
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/parse-search-query" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"<real-token>","query":"Find me CEOs of ecommerce startups"}'
```
Expected: `HTTP/1.1 404`, `{"error":"no_icp"}`.

With a real device token from a paired account that **has** a saved ICP (needs OpenRouter credits):
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/parse-search-query" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"<real-token>","query":"Find me CEOs of ecommerce startups"}'
```
Expected: `HTTP/1.1 200`, body like `{"title":"CEO","keywords":"ecommerce OR DTC","location":""}`. If this instead returns a `502`, see "Notes on Unverified Assumptions" above about OpenRouter's `json_schema` strict-mode support.

- [ ] **Step 5: Add lead dedup to `score-lead`**

In `supabase/functions/score-lead/index.ts`, insert this block right after the `user_id = pairing.user_id` line and before the ICP fetch:

```ts
  if (profile_data.linkedin_url) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, match_score, match_reasons")
      .eq("user_id", user_id)
      .eq("linkedin_url", profile_data.linkedin_url)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({
          lead_id: existing.id,
          match_score: existing.match_score,
          match_reasons: existing.match_reasons,
        }),
        { headers: jsonHeaders }
      )
    }
  }
```

This makes repeated agent runs (and the existing passive scan) skip re-scoring and re-inserting a lead already on file for the same `linkedin_url`, instead of creating duplicate rows — the accuracy limitation noted in the spec (self-reported, possibly stale card data) is unrelated to this; this only prevents literal duplicate `leads` rows for the same profile URL.

- [ ] **Step 6: Verify score-lead's existing behavior still works**

```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/score-lead" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"bogus","profile_data":{"name":"X"}}'
```
Expected: unchanged, `HTTP/1.1 401`, `{"error":"unpaired"}` (confirms the new block didn't break the existing auth flow — this path returns before reaching the new dedup block).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/parse-search-query supabase/config.toml supabase/functions/score-lead/index.ts
git commit -m "feat: add parse-search-query Edge Function and lead dedup in score-lead"
```

---

### Task 2: Extension Manifest + Side Panel Scaffold + Per-Tab Enable/Disable

**Files:**
- Modify: `extension/wxt.config.ts` (add `sidePanel`/`tabs` permissions, `side_panel.default_path`)
- Modify: `extension/package.json` (add `@types/chrome`)
- Create: `extension/entrypoints/sidepanel/index.html`
- Create: `extension/entrypoints/sidepanel/main.tsx`
- Create: `extension/entrypoints/sidepanel/style.css`
- Create: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: `getDeviceToken` from `@/lib/pairing` (unchanged).
- Produces: a Chrome Side Panel that's enabled only while the active tab is on `linkedin.com`, showing paired/unpaired status. Task 3 replaces `App.tsx`'s body with the full query UI.

- [ ] **Step 1: Add the `@types/chrome` dependency**

Run: `pnpm --dir extension add -D @types/chrome`
Expected: `extension/package.json` devDependencies gains `@types/chrome`.

- [ ] **Step 2: Update the manifest config**

Replace `extension/wxt.config.ts` with:

```ts
import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Glint",
    description: "Score LinkedIn leads against your ICP as you browse.",
    action: { default_title: "Glint" },
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: ["*://*.linkedin.com/*"],
    side_panel: { default_path: "sidepanel.html" },
  },
})
```

- [ ] **Step 3: Create the side panel entrypoint files**

`extension/entrypoints/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Glint</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`extension/entrypoints/sidepanel/style.css`:

```css
@import "tailwindcss";
```

`extension/entrypoints/sidepanel/main.tsx`:

```tsx
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import "./style.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`extension/entrypoints/sidepanel/App.tsx`:

```tsx
import { useEffect, useState } from "react"
import { getDeviceToken } from "@/lib/pairing"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)

  useEffect(() => {
    getDeviceToken().then((t) => setPaired(t !== null))
  }, [])

  if (paired === null) {
    return <div className="p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {paired ? (
        <p className="text-sm text-green-600">Extension paired ✓</p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Open the Glint extension icon popup to pair with your account first.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire up per-tab side panel enable/disable in the background script**

Replace `extension/entrypoints/background.ts` with:

```ts
function isLinkedIn(url: string | undefined): boolean {
  return !!url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//.test(url)
}

async function syncPanelForTab(tabId: number, url: string | undefined) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isLinkedIn(url),
    })
  } catch {
    // tab may have closed mid-update; ignore
  }
}

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      syncPanelForTab(tabId, tab.url)
    }
  })

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => syncPanelForTab(tabId, tab.url))
  })
})
```

- [ ] **Step 5: Verify it builds**

Run: `pnpm --dir extension compile && pnpm --dir extension build`
Expected: no TS errors, builds to `extension/.output/chrome-mv3`. Open `extension/.output/chrome-mv3/manifest.json` and confirm it contains `"side_panel": {"default_path": "sidepanel.html"}` and `"sidePanel"`/`"tabs"` in `"permissions"`. If WXT generated a different filename for the side panel entrypoint than `sidepanel.html`, update `default_path` in `wxt.config.ts` to match and rebuild.

- [ ] **Step 6: Verify in the browser**

Load `extension/.output/chrome-mv3` unpacked via `chrome://extensions`. Open a non-LinkedIn tab (e.g. `example.com`) and click the Glint toolbar icon — expect no side panel to open. Navigate to `linkedin.com` and click the icon again — expect the side panel to open on the right, showing "Glint" and either "Extension paired ✓" or the pairing prompt depending on whether this browser profile is already paired (Day 3's pairing flow, unchanged).

- [ ] **Step 7: Commit**

```bash
git add extension/wxt.config.ts extension/package.json extension/pnpm-lock.yaml extension/entrypoints/sidepanel extension/entrypoints/background.ts
git commit -m "feat: add Chrome Side Panel scaffold enabled only on LinkedIn tabs"
```

---

### Task 3: Sidebar Query UI, Run/Query Libs, Background Orchestration

**Files:**
- Create: `extension/lib/messages.ts`
- Create: `extension/lib/run.ts`
- Create: `extension/lib/query.ts`
- Modify: `extension/entrypoints/sidepanel/App.tsx`
- Modify: `extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: `getDeviceToken` (`@/lib/pairing`), `parse-search-query` (Task 1).
- Produces: `extension/lib/messages.ts` exports the `RuntimeMessage` union (`StartRunMessage | StopRunMessage | ProgressMessage | StoppedMessage | RunErrorMessage`) used by the sidebar, background, and (Task 4) the content script. `extension/lib/run.ts` exports `RunState`, `getRunState()`, `setRunState(state)`, `clearRunState()` over `chrome.storage.local` key `glint_run`. `extension/lib/query.ts` exports `parseQuery(query): Promise<ParsedQuery>`, `buildSearchUrl(parsed): string`, and error classes `UnpairedError`/`NoIcpError`. The sidebar sends `START_RUN`/`STOP_RUN`; background handles them and is the only writer of `glint_run`'s `active`/`tabId`/`startedAt` fields at run start, and also clears the run if its tab closes (`chrome.tabs.onRemoved`).

- [ ] **Step 1: Write the shared message types**

`extension/lib/messages.ts`:

```ts
export type StartRunMessage = { type: "START_RUN"; query: string }
export type StopRunMessage = { type: "STOP_RUN" }
export type ProgressMessage = {
  type: "PROGRESS"
  leadCount: number
  status: string
}
export type StoppedMessage = { type: "STOPPED"; reason: string }
export type RunErrorMessage = { type: "RUN_ERROR"; error: string }

export type RuntimeMessage =
  | StartRunMessage
  | StopRunMessage
  | ProgressMessage
  | StoppedMessage
  | RunErrorMessage
```

- [ ] **Step 2: Write the run-state lib**

`extension/lib/run.ts`:

```ts
import { browser } from "wxt/browser"

const RUN_KEY = "glint_run"

export type RunState = {
  active: boolean
  tabId: number
  query: string
  startedAt: number
  leadCount: number
  maxLeads: number
  maxMinutes: number
}

export async function getRunState(): Promise<RunState | null> {
  const res = await browser.storage.local.get(RUN_KEY)
  return (res[RUN_KEY] as RunState) ?? null
}

export async function setRunState(state: RunState): Promise<void> {
  await browser.storage.local.set({ [RUN_KEY]: state })
}

export async function clearRunState(): Promise<void> {
  await browser.storage.local.remove(RUN_KEY)
}
```

- [ ] **Step 3: Write the query-parsing lib**

`extension/lib/query.ts`:

```ts
import { getDeviceToken } from "@/lib/pairing"

const env = import.meta.env as unknown as Record<string, string>

export type ParsedQuery = { title: string; keywords: string; location: string }

export class UnpairedError extends Error {}
export class NoIcpError extends Error {}

export async function parseQuery(query: string): Promise<ParsedQuery> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new UnpairedError("not paired")

  const res = await fetch(
    `${env.WXT_SUPABASE_URL}/functions/v1/parse-search-query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.WXT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ device_token, query }),
    }
  )

  if (res.status === 401) throw new UnpairedError("unpaired")
  if (res.status === 404) throw new NoIcpError("no_icp")
  if (!res.ok) throw new Error(`parse-search-query failed (${res.status})`)

  return (await res.json()) as ParsedQuery
}

export function buildSearchUrl(parsed: ParsedQuery): string {
  const params = new URLSearchParams()
  const kw = [parsed.keywords, parsed.location]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim()
  if (kw) params.set("keywords", kw)
  if (parsed.title && parsed.title.trim()) params.set("title", parsed.title.trim())
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}
```

- [ ] **Step 4: Add run orchestration to the background script**

Replace `extension/entrypoints/background.ts` with:

```ts
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError } from "@/lib/query"
import { getRunState, setRunState, clearRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

const DEFAULT_MAX_LEADS = 100
const DEFAULT_MAX_MINUTES = 20

function isLinkedIn(url: string | undefined): boolean {
  return !!url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//.test(url)
}

async function syncPanelForTab(tabId: number, url: string | undefined) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isLinkedIn(url),
    })
  } catch {
    // tab may have closed mid-update; ignore
  }
}

function sendMessage(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function startRun(query: string, tabId: number) {
  try {
    const parsed = await parseQuery(query)
    const url = buildSearchUrl(parsed)
    await setRunState({
      active: true,
      tabId,
      query,
      startedAt: Date.now(),
      leadCount: 0,
      maxLeads: DEFAULT_MAX_LEADS,
      maxMinutes: DEFAULT_MAX_MINUTES,
    })
    await chrome.tabs.update(tabId, { url })
  } catch (err) {
    const error =
      err instanceof UnpairedError
        ? "Not paired. Open the popup and pair first."
        : err instanceof NoIcpError
          ? "No ICP found. Complete onboarding in the web app first."
          : "Could not parse your request. Try again."
    sendMessage({ type: "RUN_ERROR", error })
  }
}

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      syncPanelForTab(tabId, tab.url)
    }
  })

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => syncPanelForTab(tabId, tab.url))
  })

  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type === "START_RUN") {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab?.id) startRun(message.query, tab.id)
      })
    } else if (message.type === "STOP_RUN") {
      clearRunState()
    }
  })

  chrome.tabs.onRemoved.addListener(async (closedTabId) => {
    const state = await getRunState()
    if (state?.active && state.tabId === closedTabId) {
      await clearRunState()
    }
  })
})
```

- [ ] **Step 5: Replace the sidebar with the full query UI**

Replace `extension/entrypoints/sidepanel/App.tsx` with:

```tsx
import { useEffect, useState, type FormEvent } from "react"
import { getDeviceToken } from "@/lib/pairing"
import type { RuntimeMessage } from "@/lib/messages"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [query, setQuery] = useState("")
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [leadCount, setLeadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDeviceToken().then((t) => setPaired(t !== null))
  }, [])

  useEffect(() => {
    function onMessage(message: RuntimeMessage) {
      if (message.type === "PROGRESS") {
        setLeadCount(message.leadCount)
        setStatus(message.status)
      } else if (message.type === "STOPPED") {
        setRunning(false)
        setStatus(message.reason)
      } else if (message.type === "RUN_ERROR") {
        setRunning(false)
        setError(message.error)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  function handleStart(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    setLeadCount(0)
    setRunning(true)
    chrome.runtime.sendMessage({ type: "START_RUN", query: query.trim() })
  }

  function handleStop() {
    chrome.runtime.sendMessage({ type: "STOP_RUN" })
    setRunning(false)
  }

  if (paired === null) {
    return <div className="p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {!paired ? (
        <p className="text-muted-foreground text-sm">
          Open the Glint extension icon popup to pair with your account first.
        </p>
      ) : (
        <>
          <form onSubmit={handleStart} className="flex flex-col gap-2">
            <label className="text-sm">Who are you looking for?</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me CEOs of ecommerce startups"
              className="min-h-20 rounded-md border px-3 py-1.5 text-sm"
              required
              disabled={running}
            />
            {!running ? (
              <button
                type="submit"
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                Stop
              </button>
            )}
          </form>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {(running || status) && (
            <div className="rounded-md border p-3 text-sm">
              <p>Leads found: {leadCount}</p>
              {status && <p className="text-muted-foreground">{status}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm --dir extension compile && pnpm --dir extension build`
Expected: no TS errors.

- [ ] **Step 7: Verify run start/stop plumbing (needs a paired account with a saved ICP + OpenRouter credits)**

With the stack, functions served, and the extension loaded/paired: open the side panel on a LinkedIn tab, type "Find me CEOs of ecommerce startups", click Start.
Expected: the active tab navigates to a `linkedin.com/search/results/people/?...` URL containing `title=CEO` and/or ecommerce-related `keywords`. In the background service worker's devtools console (`chrome://extensions` → Glint → "service worker" → Inspect), run `chrome.storage.local.get("glint_run", console.log)` — expect `{ active: true, tabId: <id>, query: "...", leadCount: 0, maxLeads: 100, maxMinutes: 20 }`. Click Stop in the sidebar, re-run the same storage check — expect `glint_run` to be gone.

Without pairing (unpair first via the popup), repeat with Start — expect the sidebar to show "Not paired. Open the popup and pair first." and no tab navigation.

- [ ] **Step 8: Commit**

```bash
git add extension/lib/messages.ts extension/lib/run.ts extension/lib/query.ts extension/entrypoints/sidepanel/App.tsx extension/entrypoints/background.ts
git commit -m "feat: sidebar query UI, run-state lib, and background run orchestration"
```

---

### Task 4: Content Script Agent Loop

**Files:**
- Modify: `extension/entrypoints/linkedin.content.ts`

**Interfaces:**
- Consumes: `extractFromNode` (`@/lib/extract`), `scoreLead` (`@/lib/score`), `getRunState`/`setRunState`/`clearRunState` (`@/lib/run`), `RuntimeMessage` (`@/lib/messages`).
- Produces: when a run is active for the current tab, the content script drives the search-results page (score, badge, paginate/scroll, enforce caps/pacing/stop-conditions) instead of relying on user scrolling, and posts `PROGRESS`/`STOPPED` messages. The existing passive `MutationObserver` scan stands down while a run is active (checked via a local flag kept in sync with `browser.storage.onChanged`) so the two modes never double-score the same cards.

- [ ] **Step 1: Replace the content script**

Replace `extension/entrypoints/linkedin.content.ts` with:

```ts
import { browser } from "wxt/browser"
import { extractFromNode, type LeadCandidate } from "@/lib/extract"
import { scoreLead } from "@/lib/score"
import { getRunState, setRunState, clearRunState, type RunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

const SEARCH_RESULT_SELECTOR =
  'li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((r) => setTimeout(r, ms))
}

function hasCommercialLimitBanner(): boolean {
  return /commercial use limit/i.test(document.body.innerText)
}

function clickNextPage(): boolean {
  const next = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Next"]:not([disabled])'
  )
  if (!next) return false
  next.click()
  return true
}

function badgeColor(score: number): string {
  if (score >= 80) return "#15803d"
  if (score >= 50) return "#a16207"
  return "#6b7280"
}

function injectBadge(node: Element, score: number, reasons: string[]) {
  try {
    if (node.querySelector(":scope > .glint-badge")) return
    const b = document.createElement("span")
    b.className = "glint-badge"
    b.textContent = `Glint ${score}`
    b.title = reasons.join(" • ")
    b.setAttribute(
      "style",
      [
        "display:inline-block",
        "margin:4px 0",
        "padding:2px 8px",
        "border-radius:9999px",
        "font:600 11px/1.4 system-ui,sans-serif",
        "color:#fff",
        `background:${badgeColor(score)}`,
        "position:relative",
        "z-index:9999",
      ].join(";")
    )
    node.prepend(b)
  } catch {
    // never break LinkedIn's page
  }
}

function sendMessage(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function stopRun(reason: string) {
  await clearRunState()
  sendMessage({ type: "STOPPED", reason })
}

function postProgress(leadCount: number, status: string) {
  sendMessage({ type: "PROGRESS", leadCount, status })
}

async function runAgentLoop() {
  const seen = new Set<string>()
  let staleRounds = 0

  while (true) {
    const state: RunState | null = await getRunState()
    if (!state || !state.active) return

    const elapsedMinutes = (Date.now() - state.startedAt) / 60000
    if (state.leadCount >= state.maxLeads) {
      await stopRun("Reached lead limit")
      return
    }
    if (elapsedMinutes >= state.maxMinutes) {
      await stopRun("Reached time limit")
      return
    }
    if (document.hidden) {
      await randomDelay(2000, 4000)
      continue
    }
    if (hasCommercialLimitBanner()) {
      await stopRun("LinkedIn search limit reached — try again later")
      return
    }

    const cards = Array.from(document.querySelectorAll(SEARCH_RESULT_SELECTOR))
    let scoredThisBatch = 0

    for (const node of cards) {
      const cand = extractFromNode(node)
      if (!cand) continue
      const key = cand.linkedin_url ?? `${cand.name ?? ""}|${cand.company ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)

      const result = await scoreLead(cand)
      if (result) {
        injectBadge(node, result.match_score, result.match_reasons)
        scoredThisBatch++
        state.leadCount++
        await setRunState(state)
        postProgress(state.leadCount, `Scored ${cand.name ?? "a lead"}`)
      }
      await randomDelay(400, 900)
    }

    if (scoredThisBatch === 0) {
      staleRounds++
      if (staleRounds >= 3) {
        await stopRun("No more new results found")
        return
      }
    } else {
      staleRounds = 0
    }

    if (!clickNextPage()) {
      window.scrollBy(0, window.innerHeight * 0.8)
    }
    await randomDelay(3000, 8000)
  }
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    let agentActive = false

    // --- existing passive scan (unchanged behavior, now gated off during a run) ---
    const seen = new Set<string>()
    const queue: { node: Element; cand: LeadCandidate }[] = []
    let draining = false

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
    }

    async function drain() {
      if (draining) return
      draining = true
      while (queue.length) {
        const { node, cand } = queue.shift()!
        const result = await scoreLead(cand)
        if (result) injectBadge(node, result.match_score, result.match_reasons)
        await new Promise((r) => setTimeout(r, 400))
      }
      draining = false
    }

    function scan(root: ParentNode) {
      if (agentActive) return
      const candidates = root.querySelectorAll(
        'div.feed-shared-update-v2, [data-urn*="urn:li:activity"], li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'
      )
      candidates.forEach((node) => {
        const cand = extractFromNode(node)
        if (!cand) return
        const key = keyOf(cand)
        if (seen.has(key)) return
        seen.add(key)
        queue.push({ node, cand })
      })
      if (queue.length) drain()
    }

    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(() => scan(document), 500)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    scan(document)

    // --- agent mode ---
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.glint_run) return
      const newState = changes.glint_run.newValue as RunState | undefined
      agentActive = !!newState?.active
    })

    getRunState().then((state) => {
      if (state?.active) {
        agentActive = true
        runAgentLoop()
      }
    })
  },
})
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm --dir extension compile && pnpm --dir extension build`
Expected: no TS errors.

- [ ] **Step 3: Verify the agent loop on real LinkedIn (needs a paired account with a saved ICP + OpenRouter credits)**

Start a run from the sidebar as in Task 3 Step 7. On the LinkedIn search-results page, open DevTools console on that tab.
Expected: badges (`Glint <score>`, colored by score) appear on cards one at a time, a few hundred ms to ~1s apart within a batch, then a 3–8s pause before the next page/scroll. The sidebar's "Leads found" counter increases live. After the visible cards are scored, confirm the page either clicks to the next results page or scrolls down — **if neither happens and results stay static, LinkedIn's pagination UI doesn't match `button[aria-label="Next"]`; inspect the actual button's `aria-label`/selector and update `clickNextPage()` accordingly** (see "Notes on Unverified Assumptions").

Switch to a different browser tab mid-run — confirm scoring pauses (no new badges appear) and resumes when you switch back. Click Stop in the sidebar — confirm no further badges appear and the sidebar shows the run as stopped.

Separately, confirm passive mode still works: with no run active, manually scroll a LinkedIn feed — confirm cards still get badged as in Day 4 (unaffected by the `agentActive` gate, which is `false` outside a run).

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/linkedin.content.ts
git commit -m "feat: autonomous search-results agent loop with pacing, caps, and stop conditions"
```

---

### Task 5: End-to-End Verification

- [ ] Stack up (`pnpm exec supabase start`), functions served (`pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env`), web app running (`pnpm --dir web dev`), extension built and loaded unpacked, paired (Day 3 flow), and a real ICP saved for the test account (Day 1 onboarding).
- [ ] Open LinkedIn, click the Glint icon → side panel opens (confirms Task 2's per-tab gating still works after all later changes).
- [ ] Type a canonical-title query ("Find me CEOs of ecommerce startups") → Start → confirm the tab navigates, badges appear on cards, sidebar shows a live lead count, and new leads appear in `/inbox` in the web app in realtime (Day 4's realtime pipeline, unchanged).
- [ ] Type a persona query ("Find me ecomm shop owners") → confirm `title` comes back empty and `keywords` carries the search (visible in the constructed search URL).
- [ ] Let a run hit its cap (temporarily lower `DEFAULT_MAX_LEADS` in `background.ts` to something like 3 for this test only, then revert) — confirm it stops itself with "Reached lead limit" shown in the sidebar.
- [ ] Confirm `select count(*) from leads` in the local DB increases during a run and stops increasing after Stop is clicked.
- [ ] Re-run the exact same query a second time — confirm previously-scored `linkedin_url`s don't create duplicate `leads` rows (Task 1 Step 5's dedup).
