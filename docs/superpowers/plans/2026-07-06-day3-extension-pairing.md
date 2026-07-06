# Day 3 — Chrome Extension (WXT) & Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the passive-scan Chrome extension (WXT + React + TS) and the pairing system that binds an extension install to a Glint user, so the extension can detect LinkedIn profiles/posts on screen and (in Day 4) authenticate its `score-lead` calls without ever handling LinkedIn or Supabase credentials.

**Architecture:** Pairing uses a two-token handshake. The signed-in web app calls a `create-pairing` Edge Function (authenticated by the user's Supabase JWT) that mints a short, human-typable **pairing code** (10-minute expiry) in `extension_pairings`. The extension popup sends that code to a public `pair-extension` Edge Function, which validates it and returns a long-lived opaque **device token**; the extension stores the token in `chrome.storage.local`. From Day 4 on, the extension sends the device token with every `score-lead` request and the backend resolves `user_id` from `extension_pairings` — the client never asserts its own `user_id`. A content script runs only on `linkedin.com`, using a `MutationObserver` to passively detect already-rendered profile cards and feed posts (no navigation, no tab creation) and extract lead fields. In Day 3 the content script logs what it extracts; wiring it to `score-lead` and drawing inline badges is Day 4.

**Tech Stack:** WXT (Vite-based, file-based entrypoints, cross-browser manifest generation), React 19 + TypeScript + Tailwind v4 (`@tailwindcss/vite`) for the popup, Supabase Edge Functions (Deno) reusing Day 2's `_shared` folder, Supabase CLI/local stack, pnpm. The extension lives in `extension/` as its own pnpm project, separate from `web/`.

All file paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **No LinkedIn OAuth, no LinkedIn credentials, no navigation.** The content script is a passive passenger: `MutationObserver` on already-rendered DOM only — never `chrome.tabs.create`, never programmatic scroll (auto-scroll is an explicit Day-5 stretch, out of scope here).
- **Content-script host permission is `*://*.linkedin.com/*` only.** No broad host permissions.
- **The extension never asserts its own `user_id`.** Identity is the device token; the backend maps token → `user_id` via `extension_pairings`. `user_id` in a `score-lead` body (Day 2's shape) is a transitional dev-only path and must be replaced by token resolution in Day 4.
- **Pairing codes are short-lived (10 min) and single-use.** Once exchanged, `paired_at` is set and the code cannot be reused. Device tokens are long-lived until the pairing row is deleted (revoked) from the web app.
- **Secrets stay in Edge Function env files** (`supabase/functions/**/.env`, already gitignored). The extension ships only the Supabase project URL and anon key (public by design) — never a service-role key.
- **Reuse, don't duplicate:** the pairing Edge Functions use the same `supabase/functions/_shared/` folder introduced in Day 2. No second copy of shared helpers.
- **No automated test suite** — verify manually via `curl`, the browser, and the extension loaded unpacked in Chrome, matching Days 1–2.
- **Local dev requires Docker Desktop** for the Supabase stack. Extension pairing/code validation is fully testable without Bynara credits (no LLM calls in Day 3).
- Out of scope for Day 3: calling `score-lead` from the extension, inline score badges, Supabase Realtime, and auto-scroll.

---

### Task 1: `extension_pairings` Table Migration & RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_extension_pairings_table.sql`

**Interfaces:**
- Consumes: `auth.users`.
- Produces: `public.extension_pairings` — `id uuid pk`, `user_id uuid not null references auth.users`, `pairing_code text unique not null`, `device_token text unique`, `expires_at timestamptz not null`, `paired_at timestamptz`, `created_at timestamptz default now()`. RLS enabled; the user may `select` and `delete` (revoke) their own rows. Inserts/updates happen only through Edge Functions using the service-role key (RLS bypass), so no insert/update policy is defined. Later tasks: `create-pairing` inserts rows; `pair-extension` updates `device_token`/`paired_at`; Day-4 `score-lead` selects by `device_token`.

- [ ] **Step 1: Create the migration file**

Run (repo root): `pnpm exec supabase migration new create_extension_pairings_table`
Expected: creates `supabase/migrations/<timestamp>_create_extension_pairings_table.sql`. Note the filename.

- [ ] **Step 2: Write the migration**

Replace the generated file's contents with:

```sql
create table public.extension_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  pairing_code text unique not null,
  device_token text unique,
  expires_at timestamptz not null,
  paired_at timestamptz,
  created_at timestamptz default now()
);

create index extension_pairings_user_idx
  on public.extension_pairings (user_id, created_at desc);

alter table public.extension_pairings enable row level security;

create policy "Users can view their own pairings"
  on public.extension_pairings for select
  using (auth.uid() = user_id);

create policy "Users can revoke their own pairings"
  on public.extension_pairings for delete
  using (auth.uid() = user_id);
```

- [ ] **Step 3: Apply the migration**

Run (repo root): `pnpm exec supabase migration up`
Expected: applies with no error. (Run `pnpm exec supabase start` first if the stack is stopped.)

- [ ] **Step 4: Verify table, RLS, and policies**

Run:
```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -c "\d public.extension_pairings"
docker exec supabase_db_Glint psql -U postgres -d postgres -t -c "select policyname from pg_policies where tablename='extension_pairings';"
```
Expected: 7 columns; two policies (view/revoke).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add extension_pairings table with RLS"
```

---

### Task 2: `create-pairing` Edge Function (web-app authenticated)

**Files:**
- Create: `supabase/functions/create-pairing/index.ts`

**Interfaces:**
- Consumes: the caller's Supabase access token via the `Authorization: Bearer <jwt>` header (default `verify_jwt` behavior); `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injected).
- Produces: `POST` (no body needed) → `{ pairing_code: string, expires_at: string }`. Creates one `extension_pairings` row for the authenticated user with a fresh 8-char uppercase code and a 10-minute expiry. 401 if the JWT is missing/invalid.

- [ ] **Step 1: Scaffold**

Run (repo root): `pnpm exec supabase functions new create-pairing`

- [ ] **Step 2: Replace with the implementation**

`supabase/functions/create-pairing/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I,O,0,1
const CODE_LENGTH = 8
const TTL_MS = 10 * 60 * 1000

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let out = ""
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get("Authorization") ?? ""

  // Identify the caller from their JWT using an anon client bound to the header.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()

  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const pairing_code = makeCode()
  const expires_at = new Date(Date.now() + TTL_MS).toISOString()

  const { error } = await admin.from("extension_pairings").insert({
    user_id: user.id,
    pairing_code,
    expires_at,
  })

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ pairing_code, expires_at }), {
    headers: jsonHeaders,
  })
})
```

- [ ] **Step 3: Verify (needs a signed-in user's JWT)**

Serve functions, then get a user access token. Easiest: in the running web app browser devtools console on `localhost:3000` while signed in, run
`(await (await fetch('/api/whoami')).json())` is not available — instead read the token from the Supabase client: open Application → Local Storage → the `sb-...-auth-token` entry and copy its `access_token`. Then:

```bash
pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env
```
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/create-pairing" \
  -H "Authorization: Bearer <user-access-token>" -H "Content-Type: application/json"
```
Expected: `HTTP/1.1 200`, body `{"pairing_code":"XXXXXXXX","expires_at":"…"}`. With no/invalid token → `401 {"error":"unauthorized"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-pairing/index.ts supabase/functions/create-pairing/deno.json supabase/functions/create-pairing/.npmrc supabase/config.toml
git commit -m "feat: add create-pairing Edge Function"
```

---

### Task 3: `pair-extension` Edge Function (public, code → device token)

**Files:**
- Create: `supabase/functions/pair-extension/index.ts`
- Modify: `supabase/config.toml` (set `verify_jwt = false` for this function — the extension has no Supabase JWT)

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `POST { pairing_code: string }` → `{ device_token: string }` on success. Validates the code exists, is unexpired, and unused (`paired_at is null`); then generates a long random `device_token`, sets it plus `paired_at = now()`, and returns it. 400 on missing code; 404 `{ error: "invalid_code" }` when not found / expired / already used. Day-4 `score-lead` will look up `user_id` by this `device_token`.

- [ ] **Step 1: Scaffold**

Run (repo root): `pnpm exec supabase functions new pair-extension`

- [ ] **Step 2: Replace with the implementation**

`supabase/functions/pair-extension/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function makeDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  let body: { pairing_code?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const code = body.pairing_code?.trim().toUpperCase()
  if (!code) {
    return new Response(JSON.stringify({ error: "missing_code" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: row } = await admin
    .from("extension_pairings")
    .select("id, expires_at, paired_at")
    .eq("pairing_code", code)
    .maybeSingle()

  if (
    !row ||
    row.paired_at !== null ||
    new Date(row.expires_at).getTime() < Date.now()
  ) {
    return new Response(JSON.stringify({ error: "invalid_code" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  const device_token = makeDeviceToken()
  const { error } = await admin
    .from("extension_pairings")
    .update({ device_token, paired_at: new Date().toISOString() })
    .eq("id", row.id)

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ device_token }), { headers: jsonHeaders })
})
```

- [ ] **Step 3: Set `verify_jwt = false` for this function**

In `supabase/config.toml`, find the `[functions.pair-extension]` block created by `functions new` and set `verify_jwt = false` (mirroring `[functions.score-lead]`). If the block is missing, add:

```toml
[functions.pair-extension]
enabled = true
verify_jwt = false
```

- [ ] **Step 4: Verify with the code from Task 2**

Re-serve if needed, then exchange a real code (from a Task-2 `create-pairing` call):

```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/pair-extension" \
  -H "Content-Type: application/json" -d '{"pairing_code":"<code-from-task-2>"}'
```
Expected: `HTTP/1.1 200`, body `{"device_token":"<64 hex chars>"}`. Re-running the same code → `404 {"error":"invalid_code"}` (single-use). A bogus code → `404`.

- [ ] **Step 5: Confirm the row updated**

```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -c \
  "select left(pairing_code,4) as code, (device_token is not null) as paired, paired_at from public.extension_pairings order by created_at desc limit 1;"
```
Expected: `paired = t`, `paired_at` populated.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pair-extension/index.ts supabase/functions/pair-extension/deno.json supabase/functions/pair-extension/.npmrc supabase/config.toml
git commit -m "feat: add pair-extension Edge Function (code to device token)"
```

---

### Task 4: Web App "Connect Extension" Settings Page

**Files:**
- Create: `web/app/settings/page.tsx`
- Create: `web/app/settings/pairing-panel.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (auth guard) and `@/lib/supabase/client` (`functions.invoke("create-pairing")`, and `from("extension_pairings")` select/delete under RLS).
- Produces: `/settings` — a signed-in page that generates a pairing code on demand and lists existing pairings with a revoke button.

- [ ] **Step 1: Write the settings page (auth guard)**

`web/app/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PairingPanel } from "./pairing-panel"

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  return <PairingPanel />
}
```

- [ ] **Step 2: Write the pairing panel client component**

`web/app/settings/pairing-panel.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

type Pairing = {
  id: string
  paired_at: string | null
  created_at: string
}

export function PairingPanel() {
  const supabase = createClient()
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pairings, setPairings] = useState<Pairing[]>([])

  const loadPairings = useCallback(async () => {
    const { data } = await supabase
      .from("extension_pairings")
      .select("id, paired_at, created_at")
      .order("created_at", { ascending: false })
    setPairings((data ?? []) as Pairing[])
  }, [supabase])

  useEffect(() => {
    loadPairings()
  }, [loadPairings])

  async function generate() {
    setLoading(true)
    const { data, error } = await supabase.functions.invoke<{
      pairing_code: string
    }>("create-pairing", { method: "POST" })
    setLoading(false)
    if (!error && data) {
      setCode(data.pairing_code)
      loadPairings()
    }
  }

  async function revoke(id: string) {
    await supabase.from("extension_pairings").delete().eq("id", id)
    loadPairings()
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-medium">Connect extension</h1>
        <p className="text-muted-foreground text-sm">
          Generate a code, then paste it into the Glint extension popup. Codes
          expire in 10 minutes.
        </p>
        <Button onClick={generate} disabled={loading} className="self-start">
          {loading ? "Generating..." : "Generate pairing code"}
        </Button>
        {code && (
          <p className="rounded-md border p-3 text-center font-mono text-2xl tracking-widest">
            {code}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Paired devices</h2>
        {pairings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pairings yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pairings.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <span>
                  {p.paired_at
                    ? `Paired ${new Date(p.paired_at).toLocaleString()}`
                    : "Pending — code not yet used"}
                </span>
                <Button size="sm" variant="outline" onClick={() => revoke(p.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles**

Run (cwd `web/`): `pnpm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Verify in the browser**

With the stack + functions served + `pnpm dev` running, sign in and visit `http://localhost:3000/settings`. Click "Generate pairing code" → an 8-char code appears and a "Pending" row shows under Paired devices. Revoke removes it. (Full pairing round-trip is verified in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add web/app/settings/page.tsx web/app/settings/pairing-panel.tsx
git commit -m "feat: add Connect Extension settings page with pairing codes"
```

---

### Task 5: WXT Extension Scaffold

**Files:**
- Create: `extension/` (WXT React+TS project) — `package.json`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/`
- Create: `extension/.env` (Supabase URL + anon key for the extension; gitignored)
- Modify: repo root `.gitignore` (ignore `extension/node_modules`, `extension/.output`, `extension/.wxt`)

**Interfaces:**
- Consumes: nothing yet.
- Produces: a buildable WXT extension with a React popup and a `linkedin.com` content-script entrypoint. `pnpm --dir extension dev` runs it; `pnpm --dir extension build` produces `extension/.output/chrome-mv3` to load unpacked.

- [ ] **Step 1: Scaffold WXT (React template)**

Run (repo root): `pnpm dlx wxt@latest init extension --template react --pm pnpm`
Expected: creates `extension/` with WXT's React starter (`entrypoints/popup/`, `wxt.config.ts`, `package.json`). If init runs interactively, choose template **react** and package manager **pnpm**.

- [ ] **Step 2: Install extension deps**

Run: `pnpm --dir extension install`
Expected: `extension/node_modules` created.

- [ ] **Step 3: Add Tailwind v4 for the popup**

Run: `pnpm --dir extension add -D tailwindcss @tailwindcss/vite`

Replace `extension/wxt.config.ts` with:

```ts
import { defineConfig } from "wxt"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Glint",
    description: "Score LinkedIn leads against your ICP as you browse.",
    permissions: ["storage"],
    host_permissions: ["*://*.linkedin.com/*"],
  },
})
```

Create `extension/entrypoints/popup/style.css`:

```css
@import "tailwindcss";
```

Ensure `extension/entrypoints/popup/main.tsx` imports it (add `import "./style.css"` at the top if the template used a different css filename; delete the template's `App.css`/`index.css` references you replace).

- [ ] **Step 4: Add the extension env file**

`extension/.env` (WXT exposes `import.meta.env.WXT_*` to code):

```
WXT_SUPABASE_URL=http://127.0.0.1:54321
WXT_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
```

- [ ] **Step 5: Ignore extension build artifacts**

Append to repo-root `.gitignore`:

```
extension/node_modules/
extension/.output/
extension/.wxt/
extension/.env
```

- [ ] **Step 6: Verify it builds**

Run: `pnpm --dir extension build`
Expected: builds to `extension/.output/chrome-mv3` with no error. Load that folder via `chrome://extensions` → Developer mode → "Load unpacked" and confirm the popup opens.

- [ ] **Step 7: Commit**

```bash
git add extension .gitignore
git commit -m "feat: scaffold WXT React extension with Tailwind and LinkedIn host permissions"
```

---

### Task 6: Extension Popup Pairing UI

**Files:**
- Modify: `extension/entrypoints/popup/App.tsx`
- Create: `extension/lib/pairing.ts`

**Interfaces:**
- Consumes: `WXT_SUPABASE_URL`, `WXT_SUPABASE_ANON_KEY`; the `pair-extension` Edge Function from Task 3.
- Produces: a popup that accepts a pairing code, exchanges it via `pair-extension`, stores `device_token` in `chrome.storage.local` under key `glint_device_token`, and shows paired/unpaired state with an Unpair button. `extension/lib/pairing.ts` exports `getDeviceToken()`, `setDeviceToken()`, `clearDeviceToken()`, and `pair(code)` — reused by the content script in Day 4.

- [ ] **Step 1: Write the pairing lib**

`extension/lib/pairing.ts`:

```ts
const TOKEN_KEY = "glint_device_token"

export async function getDeviceToken(): Promise<string | null> {
  const res = await chrome.storage.local.get(TOKEN_KEY)
  return (res[TOKEN_KEY] as string) ?? null
}

export async function setDeviceToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token })
}

export async function clearDeviceToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY)
}

export async function pair(code: string): Promise<void> {
  const url = `${import.meta.env.WXT_SUPABASE_URL}/functions/v1/pair-extension`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ pairing_code: code }),
  })
  if (!res.ok) throw new Error("invalid_code")
  const { device_token } = (await res.json()) as { device_token: string }
  await setDeviceToken(device_token)
}
```

- [ ] **Step 2: Write the popup**

`extension/entrypoints/popup/App.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react"
import {
  clearDeviceToken,
  getDeviceToken,
  pair,
} from "@/lib/pairing"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getDeviceToken().then((t) => setPaired(t !== null))
  }, [])

  async function handlePair(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(false)
    try {
      await pair(code.trim())
      setPaired(true)
      setCode("")
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleUnpair() {
    await clearDeviceToken()
    setPaired(false)
  }

  if (paired === null) {
    return <div className="w-72 p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex w-72 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {paired ? (
        <>
          <p className="text-sm text-green-600">Extension paired ✓</p>
          <button
            onClick={handleUnpair}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Unpair
          </button>
        </>
      ) : (
        <form onSubmit={handlePair} className="flex flex-col gap-2">
          <label className="text-sm">
            Paste your pairing code from Glint → Settings.
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXXXX"
            className="rounded-md border px-3 py-1.5 font-mono tracking-widest uppercase"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
          {error && (
            <p className="text-sm text-red-600">
              Invalid or expired code. Generate a new one.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
```

(If the WXT React template's `App.tsx` has a default export named differently or imports demo assets, replace the whole file with the above and remove now-unused template imports.)

- [ ] **Step 3: Verify the pairing round-trip end-to-end**

With the stack, functions (`pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env`), and web `pnpm dev` running, and the extension loaded (`pnpm --dir extension dev` or the built unpacked folder):
1. Web: sign in → `/settings` → Generate pairing code.
2. Extension popup: paste the code → Pair → shows "Extension paired ✓".
3. Web `/settings`: the pairing row flips to "Paired <time>".
4. DB check:
   ```bash
   docker exec supabase_db_Glint psql -U postgres -d postgres -c \
     "select (device_token is not null) as paired from public.extension_pairings order by created_at desc limit 1;"
   ```
   Expected `paired = t`.
5. Re-pasting the same code in the popup → "Invalid or expired code" (single-use).

- [ ] **Step 4: Commit**

```bash
git add extension/lib/pairing.ts extension/entrypoints/popup/App.tsx
git commit -m "feat: extension popup pairing flow storing device token"
```

---

### Task 7: LinkedIn Content Script (Passive Detection)

**Files:**
- Create: `extension/entrypoints/linkedin.content.ts`
- Create: `extension/lib/extract.ts`

**Interfaces:**
- Consumes: nothing from the backend yet (Day 4 wires `score-lead`).
- Produces: a content script matched to `*://*.linkedin.com/*` that observes the DOM and, for each newly rendered profile card or feed post, extracts `{ name, headline, company, post_text, linkedin_url, source }` and `console.debug`s it (deduped by `linkedin_url`/DOM node). `extract.ts` exports `extractFromNode(node: Element): LeadCandidate | null` and the `LeadCandidate` type, so Day 4 can import the same extraction without rewriting selectors.

- [ ] **Step 1: Write the extraction module**

`extension/lib/extract.ts`:

```ts
export type LeadCandidate = {
  name: string | null
  headline: string | null
  company: string | null
  post_text: string | null
  linkedin_url: string | null
  source: "profile" | "post" | "search_result"
}

function text(el: Element | null): string | null {
  const t = el?.textContent?.replace(/\s+/g, " ").trim()
  return t && t.length > 0 ? t : null
}

function firstProfileLink(node: Element): string | null {
  const a = node.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  if (!a) return null
  try {
    const u = new URL(a.href, location.origin)
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

// LinkedIn's DOM is unstable; every selector is best-effort and must fail soft.
export function extractFromNode(node: Element): LeadCandidate | null {
  try {
    // Feed post
    if (node.matches('div.feed-shared-update-v2, [data-urn*="urn:li:activity"]')) {
      const name = text(
        node.querySelector(".update-components-actor__title span[aria-hidden='true']") ??
          node.querySelector(".update-components-actor__title")
      )
      const headline = text(
        node.querySelector(".update-components-actor__description")
      )
      const post_text = text(
        node.querySelector(".update-components-text, .feed-shared-update-v2__description")
      )
      const linkedin_url = firstProfileLink(node)
      if (!name && !post_text) return null
      return {
        name,
        headline,
        company: null,
        post_text,
        linkedin_url,
        source: "post",
      }
    }

    // Search result / people card
    if (
      node.matches(
        'li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'
      )
    ) {
      const name = text(
        node.querySelector(".entity-result__title-text a span[aria-hidden='true']") ??
          node.querySelector(".entity-result__title-text a")
      )
      const headline = text(node.querySelector(".entity-result__primary-subtitle"))
      const company = text(node.querySelector(".entity-result__secondary-subtitle"))
      const linkedin_url = firstProfileLink(node)
      if (!name) return null
      return {
        name,
        headline,
        company,
        post_text: null,
        linkedin_url,
        source: "search_result",
      }
    }

    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Write the content script**

`extension/entrypoints/linkedin.content.ts`:

```ts
import { extractFromNode, type LeadCandidate } from "@/lib/extract"

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    const seen = new Set<string>()

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
    }

    function scan(root: ParentNode) {
      const candidates = root.querySelectorAll(
        'div.feed-shared-update-v2, [data-urn*="urn:li:activity"], li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'
      )
      candidates.forEach((node) => {
        const cand = extractFromNode(node)
        if (!cand) return
        const key = keyOf(cand)
        if (seen.has(key)) return
        seen.add(key)
        // Day 4 replaces this with a score-lead call + inline badge.
        console.debug("[glint] lead candidate", cand)
      })
    }

    scan(document)

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n instanceof Element) scan(n)
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  },
})
```

- [ ] **Step 3: Verify detection on LinkedIn**

Run `pnpm --dir extension dev` (or rebuild + reload the unpacked extension). In Chrome, open `linkedin.com`, run a people search or scroll the feed, open DevTools console on the LinkedIn tab.
Expected: `[glint] lead candidate {…}` lines appear as cards render, each with best-effort `name` / `headline` / `linkedin_url`, and no duplicate spam for the same card. Some selectors may miss if LinkedIn's markup differs — note which surfaces work; broken selectors must log nothing, never throw (the try/catch guarantees fail-soft).

- [ ] **Step 4: Commit**

```bash
git add extension/entrypoints/linkedin.content.ts extension/lib/extract.ts
git commit -m "feat: passive LinkedIn content script extracting lead candidates"
```

---

### Notes carried into Day 4

- Replace the content script's `console.debug` with a `score-lead` call that sends the **device token** (not a `user_id`); harden `score-lead` to resolve `user_id` from `extension_pairings.device_token` and drop the body `user_id` path.
- Draw the returned score as an inline badge on the card (Shadow DOM to avoid LinkedIn CSS bleed).
- Subscribe the inbox to Supabase Realtime so scored leads appear live.
- Debounce/rate-limit scans on rapid scroll before hitting `score-lead`.
```
