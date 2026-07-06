# Day 2 — Leads Schema, `score-lead` Edge Function & Lead Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `leads` table, a `score-lead` Edge Function that scores a scraped LinkedIn profile/post against the user's ICP and persists the result, and a lead inbox UI that lists, filters, and lets the user change each lead's status.

**Architecture:** Both Edge Functions (`generate-icp` from Day 1 and the new `score-lead`) talk to the **Bynara router** (an OpenAI-compatible LLM gateway) through a single shared helper `supabase/functions/_shared/llm.ts`, so there is exactly one place that knows the provider's request/response shape. `score-lead` is trusted server code: it identifies the user by a `user_id` passed in the request body (extension pairing/auth arrives Day 3–4), reads that user's ICP and writes the scored lead using the Supabase **service-role** client, bypassing RLS. The web app reads and mutates `leads` only through RLS-scoped browser/server clients (`auth.uid() = user_id`). The inbox is a Server Component that reads leads on first paint; a Client Component handles score filtering and status changes. Supabase Realtime wiring is deliberately Day 4, not here.

**Tech Stack:** Supabase CLI (local Postgres/Edge Functions, Docker required), Deno Edge Functions calling Bynara via `fetch`, `@supabase/supabase-js` (service-role client inside `score-lead`, browser client in the inbox), Next.js 16.2.6 App Router, shadcn/ui, pnpm.

All file paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **LLM provider is Bynara**, OpenAI-compatible, base URL `https://router.bynara.id/v1`, endpoint `/chat/completions`. Auth is `Authorization: Bearer <BYNARA_API_KEY>`. Structured output uses OpenAI's `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`; the model reply is read from `choices[0].message.content` and `JSON.parse`d.
- **Model is `claude-opus-4.8`** (note the dotted id the router expects — not `claude-opus-4-8`) for every LLM call unless overridden by a `LLM_MODEL` env var.
- **The Bynara API key lives only in Edge Function env files** (`supabase/functions/**/.env`), never in the web app and never committed. The web app never calls Bynara directly.
- **All `leads` access from the web app is RLS-scoped to `auth.uid() = user_id`.** `score-lead` uses the service-role key (auto-provided to the Edge runtime as `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`) and is the only writer that bypasses RLS.
- **Save every scored lead** — `score-lead` inserts all results regardless of score; filtering by score happens in the inbox UI, never in the backend.
- **No automated test suite for this slice** — every task is verified manually via `curl` and/or the browser against the local Supabase stack, matching Day 1's testing posture.
- **Local dev requires Docker Desktop running** (`supabase start`). The Bynara account must have credits for the *happy-path* LLM calls to succeed; input-validation, ICP fallback, RLS, and inbox rendering are all verifiable without credits and must be verified regardless.
- Out of scope for Day 2: the Chrome extension, extension pairing/auth, Supabase Realtime subscriptions, and the `scan_sessions` / `extension_pairings` tables.

---

### Task 1: `leads` Table Migration & RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_leads_table.sql`

**Interfaces:**
- Consumes: `auth.users` (FK), and the `icps` table's `user_id` convention from Day 1.
- Produces: `public.leads` with columns `id uuid pk`, `user_id uuid not null references auth.users`, `name text`, `company text`, `role text`, `linkedin_url text`, `post_context text`, `match_score int`, `match_reasons text[]`, `status text default 'new'` (check in `new|contacted|ignored`), `source text default 'extension'` (check in `extension|profile|post|search_result`), `created_at timestamptz`. RLS enabled; select/insert/update/delete policies scoped to `auth.uid() = user_id`. Indexed on `(user_id, created_at desc)` and `(user_id, match_score desc)`.

- [ ] **Step 1: Create the migration file**

Run (repo root): `pnpm exec supabase migration new create_leads_table`
Expected: creates `supabase/migrations/<timestamp>_create_leads_table.sql` (empty). Note the filename.

- [ ] **Step 2: Write the migration**

Replace the generated file's contents with:

```sql
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text,
  company text,
  role text,
  linkedin_url text,
  post_context text,
  match_score int,
  match_reasons text[],
  status text not null default 'new'
    check (status in ('new', 'contacted', 'ignored')),
  source text not null default 'extension'
    check (source in ('extension', 'profile', 'post', 'search_result')),
  created_at timestamptz default now()
);

create index leads_user_created_idx
  on public.leads (user_id, created_at desc);
create index leads_user_score_idx
  on public.leads (user_id, match_score desc);

alter table public.leads enable row level security;

create policy "Users can view their own leads"
  on public.leads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own leads"
  on public.leads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own leads"
  on public.leads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own leads"
  on public.leads for delete
  using (auth.uid() = user_id);
```

- [ ] **Step 3: Apply the migration**

Run (repo root): `pnpm exec supabase migration up`
Expected: applies `create_leads_table` with no error. (If the local stack is stopped, run `pnpm exec supabase start` first — it applies pending migrations on boot.)

- [ ] **Step 4: Verify the table, RLS, and policies**

Run:
```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -c "\d public.leads"
docker exec supabase_db_Glint psql -U postgres -d postgres -t -c "select relrowsecurity from pg_class where relname='leads';"
docker exec supabase_db_Glint psql -U postgres -d postgres -t -c "select policyname from pg_policies where tablename='leads';"
```
Expected: 11 columns with the types above; `relrowsecurity` = `t`; four policies listed (view/insert/update/delete).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add leads table with RLS and score/created indexes"
```

---

### Task 2: Shared Bynara LLM Helper & `generate-icp` Migration

**Files:**
- Create: `supabase/functions/_shared/llm.ts`
- Modify: `supabase/functions/generate-icp/index.ts`
- Modify: `supabase/functions/generate-icp/.env`

**Interfaces:**
- Consumes: `BYNARA_API_KEY` (required), `BYNARA_BASE_URL` (optional, defaults to `https://router.bynara.id/v1`), `LLM_MODEL` (optional, defaults to `claude-opus-4.8`) from the function env.
- Produces: `callLLMJson<T>(opts: { messages: { role: string; content: string }[]; schema: Record<string, unknown>; schemaName: string; maxTokens?: number; model?: string }): Promise<T>` — POSTs to Bynara's `/chat/completions` with a `json_schema` response format and returns the parsed object. Throws `Error` on non-2xx or missing content. Consumed by both `generate-icp` (this task) and `score-lead` (Task 3).

- [ ] **Step 1: Write the shared helper**

`supabase/functions/_shared/llm.ts`:

```ts
const BYNARA_BASE_URL =
  Deno.env.get("BYNARA_BASE_URL") ?? "https://router.bynara.id/v1"
const DEFAULT_MODEL = Deno.env.get("LLM_MODEL") ?? "claude-opus-4.8"

export type JsonSchema = Record<string, unknown>

export async function callLLMJson<T>(opts: {
  messages: { role: string; content: string }[]
  schema: JsonSchema
  schemaName: string
  maxTokens?: number
  model?: string
}): Promise<T> {
  const res = await fetch(`${BYNARA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("BYNARA_API_KEY")!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      messages: opts.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${JSON.stringify(data)}`)
  }

  const content = data.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new Error(`LLM returned no content: ${JSON.stringify(data)}`)
  }

  return JSON.parse(content) as T
}
```

- [ ] **Step 2: Rewrite `generate-icp` to use the shared helper**

Replace the contents of `supabase/functions/generate-icp/index.ts` with:

```ts
import { callLLMJson } from "../_shared/llm.ts"

const MIN_CONTENT_LENGTH = 200

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchSiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return ""
    const html = await res.text()
    return stripHtml(html)
  } catch {
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

Deno.serve(async (req: Request) => {
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
})
```

- [ ] **Step 3: Update the generate-icp env file to the Bynara key**

Replace the contents of `supabase/functions/generate-icp/.env` with:

```
BYNARA_API_KEY=
```

Fill in the real Bynara key yourself (it is a secret — must not be committed; `functions/**/.env` is already gitignored from Day 1).

- [ ] **Step 4: Verify the fallback path still works (no credits needed)**

Serve, then curl the thin-content path (replace `<anon-key>` with the value from `pnpm exec supabase status`):

```bash
pnpm exec supabase functions serve --env-file supabase/functions/generate-icp/.env
```
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/generate-icp" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"website_url":"https://example.com"}'
```
Expected: `HTTP/1.1 200`, body `{"needs_manual_input":true}`. This confirms the refactor didn't break the pre-LLM path. (The happy path additionally requires Bynara credits — verify it in the Day 2 end-to-end step once topped up.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/llm.ts supabase/functions/generate-icp/index.ts
git commit -m "refactor: route generate-icp through shared Bynara LLM helper"
```

(`supabase/functions/generate-icp/.env` is intentionally not staged.)

---

### Task 3: `score-lead` Edge Function

**Files:**
- Create: `supabase/functions/score-lead/index.ts`
- Create: `supabase/functions/score-lead/.env`

**Interfaces:**
- Consumes: `callLLMJson` from `../_shared/llm.ts`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (auto-injected into the Edge runtime and by `supabase functions serve`); `BYNARA_API_KEY` from its env file.
- Produces: an HTTP endpoint accepting `POST { profile_data: { name?: string; headline?: string; company?: string; post_text?: string; linkedin_url?: string; source?: "extension" | "profile" | "post" | "search_result" }, user_id: string }`. Behavior: 400 if `user_id` or `profile_data` missing; 404 `{ error: "no_icp" }` if the user has no ICP row; otherwise scores against the ICP, inserts one `leads` row, and returns `{ lead_id: string, match_score: number, match_reasons: string[] }`. Day 3–4's extension consumes this exact contract.

- [ ] **Step 1: Scaffold the function**

Run (repo root): `pnpm exec supabase functions new score-lead`
Expected: creates `supabase/functions/score-lead/index.ts` with boilerplate.

- [ ] **Step 2: Replace it with the full implementation**

`supabase/functions/score-lead/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

type ProfileData = {
  name?: string
  headline?: string
  company?: string
  post_text?: string
  linkedin_url?: string
  source?: "extension" | "profile" | "post" | "search_result"
}

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
  raw_summary: string | null
}

type ScoreResult = {
  match_score: number
  match_reasons: string[]
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    match_score: { type: "integer", minimum: 0, maximum: 100 },
    match_reasons: { type: "array", items: { type: "string" } },
  },
  required: ["match_score", "match_reasons"],
  additionalProperties: false,
}

function scorePrompt(icp: Icp, profile: ProfileData): string {
  return [
    "You score how well a LinkedIn lead matches a seller's ideal customer profile (ICP).",
    "Return a match_score from 0-100 (100 = perfect fit) and 2-4 short match_reasons.",
    "",
    "ICP:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Pain points: ${(icp.pain_points ?? []).join(", ") || "n/a"}`,
    `- Summary: ${icp.raw_summary ?? "n/a"}`,
    "",
    "Lead:",
    `- Name: ${profile.name ?? "n/a"}`,
    `- Headline/role: ${profile.headline ?? "n/a"}`,
    `- Company: ${profile.company ?? "n/a"}`,
    `- Post/context: ${profile.post_text ?? "n/a"}`,
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

  let body: { profile_data?: ProfileData; user_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { profile_data, user_id } = body
  if (!user_id || !profile_data) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

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

  let score: ScoreResult
  try {
    score = await callLLMJson<ScoreResult>({
      schema: SCORE_SCHEMA,
      schemaName: "lead_score",
      maxTokens: 512,
      messages: [{ role: "user", content: scorePrompt(icp as Icp, profile_data) }],
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: jsonHeaders,
    })
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert({
      user_id,
      name: profile_data.name ?? null,
      company: profile_data.company ?? null,
      role: profile_data.headline ?? null,
      linkedin_url: profile_data.linkedin_url ?? null,
      post_context: profile_data.post_text ?? null,
      match_score: score.match_score,
      match_reasons: score.match_reasons,
      source: profile_data.source ?? "extension",
    })
    .select("id")
    .single()

  if (insertError) {
    return new Response(JSON.stringify({ error: String(insertError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(
    JSON.stringify({
      lead_id: inserted.id,
      match_score: score.match_score,
      match_reasons: score.match_reasons,
    }),
    { headers: jsonHeaders }
  )
})
```

- [ ] **Step 3: Add the local secrets file**

`supabase/functions/score-lead/.env`:

```
BYNARA_API_KEY=
```

Fill in the same real Bynara key. `functions/**/.env` is already gitignored.

- [ ] **Step 4: Verify input validation and the no-ICP path (no credits needed)**

Serve all functions with an env file that carries the key:

```bash
pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env
```

Missing fields → 400:
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/score-lead" \
  -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" \
  -d '{"profile_data":{"name":"Jane"}}'
```
Expected: `HTTP/1.1 400`, body `{"error":"missing_fields"}`.

No ICP for a random user → 404:
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/score-lead" \
  -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000000","profile_data":{"name":"Jane"}}'
```
Expected: `HTTP/1.1 404`, body `{"error":"no_icp"}`. This confirms input handling, the service-role ICP lookup, and error paths without spending any LLM credits. (The happy path — real score + inserted `leads` row — needs Bynara credits and a real ICP row; verify it in the end-to-end step.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/score-lead/index.ts
git commit -m "feat: add score-lead Edge Function"
```

(`supabase/functions/score-lead/.env` is intentionally not staged.)

---

### Task 4: Lead Inbox UI

**Files:**
- Modify: `web/app/inbox/page.tsx`
- Create: `web/app/inbox/lead-inbox.tsx`
- Create: `web/components/ui/badge.tsx` (via shadcn)
- Create: `web/components/ui/select.tsx` (via shadcn)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (auth guard + initial leads read) and `@/lib/supabase/client` (status updates); the `leads` table shape from Task 1.
- Produces: the `/inbox` route rendering the user's leads sorted by score, a client-side score filter (All / ≥80 / ≥50 / <50), and a per-lead status control that writes `status` back through RLS.

- [ ] **Step 1: Add the shadcn components**

Run (cwd `web/`): `pnpm dlx shadcn@latest add badge select --yes`
Expected: creates `web/components/ui/badge.tsx` and `web/components/ui/select.tsx`.

- [ ] **Step 2: Replace the inbox page with a real leads reader**

`web/app/inbox/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { LeadInbox, type Lead } from "./lead-inbox"

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, name, company, role, linkedin_url, post_context, match_score, match_reasons, status, created_at"
    )
    .eq("user_id", user.id)
    .order("match_score", { ascending: false })

  return <LeadInbox initialLeads={(leads ?? []) as Lead[]} />
}
```

- [ ] **Step 3: Write the inbox client component**

`web/app/inbox/lead-inbox.tsx`:

```tsx
"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type Lead = {
  id: string
  name: string | null
  company: string | null
  role: string | null
  linkedin_url: string | null
  post_context: string | null
  match_score: number | null
  match_reasons: string[] | null
  status: "new" | "contacted" | "ignored"
  created_at: string
}

type ScoreFilter = "all" | "high" | "medium" | "low"

const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "≥ 80" },
  { key: "medium", label: "50–79" },
  { key: "low", label: "< 50" },
]

const STATUSES: Lead["status"][] = ["new", "contacted", "ignored"]

function scoreBucket(score: number | null): ScoreFilter {
  if (score === null) return "low"
  if (score >= 80) return "high"
  if (score >= 50) return "medium"
  return "low"
}

function scoreVariant(
  score: number | null
): "default" | "secondary" | "outline" {
  const bucket = scoreBucket(score)
  if (bucket === "high") return "default"
  if (bucket === "medium") return "secondary"
  return "outline"
}

export function LeadInbox({ initialLeads }: { initialLeads: Lead[] }) {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [filter, setFilter] = useState<ScoreFilter>("all")

  const visible = useMemo(
    () =>
      filter === "all"
        ? leads
        : leads.filter((l) => scoreBucket(l.match_score) === filter),
    [leads, filter]
  )

  async function updateStatus(id: string, status: Lead["status"]) {
    const prev = leads
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)))
    const { error } = await supabase
      .from("leads")
      .update({ status })
      .eq("id", id)
    if (error) setLeads(prev) // roll back on failure
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Lead inbox</h1>
        <div className="flex gap-1">
          {SCORE_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No leads yet. Start browsing LinkedIn with the extension to see matches
          here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((lead) => (
            <li
              key={lead.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{lead.name ?? "Unknown"}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {[lead.role, lead.company].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge variant={scoreVariant(lead.match_score)}>
                  {lead.match_score ?? "—"}
                </Badge>
              </div>

              {lead.match_reasons && lead.match_reasons.length > 0 && (
                <ul className="text-muted-foreground list-disc pl-5 text-sm">
                  {lead.match_reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}

              {lead.post_context && (
                <p className="text-sm italic">“{lead.post_context}”</p>
              )}

              <div className="flex items-center justify-between gap-3">
                {lead.linkedin_url ? (
                  <a
                    href={lead.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline"
                  >
                    View on LinkedIn
                  </a>
                ) : (
                  <span />
                )}
                <Select
                  value={lead.status}
                  onValueChange={(v) => updateStatus(lead.id, v as Lead["status"])}
                >
                  <SelectTrigger className="w-36" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify it compiles**

Run (cwd `web/`): `pnpm run build`
Expected: `Compiled successfully`, TypeScript passes. If shadcn's `SelectTrigger` in this version does not accept a `size` prop, drop `size="sm"` from the trigger and rebuild.

- [ ] **Step 5: Verify the inbox renders with seeded data (no credits needed)**

With the local stack running, seed two leads for an existing user so the UI has something to show. Get a real user id first (sign in once via the Day 1 magic-link flow if there are no users), then:

```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -c \
  "insert into public.leads (user_id, name, company, role, post_context, match_score, match_reasons, source) values \
   ((select id from auth.users order by created_at limit 1), 'Jane Doe', 'Acme SaaS', 'VP Sales', 'Hiring 5 SDRs this quarter', 88, array['Exact target role','Company type match'], 'profile'), \
   ((select id from auth.users order by created_at limit 1), 'John Roe', 'SmallCo', 'Intern', 'Just started my career', 22, array['Role not a fit'], 'post');"
```

Run (cwd `web/`): `pnpm dev`, sign in as that user, visit `http://localhost:3000/inbox`.
Expected: both leads render sorted by score (88 above 22); the score filter buttons narrow the list; changing a lead's status dropdown persists (reload → the new status remains, because the write went through RLS).

- [ ] **Step 6: Commit**

```bash
git add web/app/inbox/page.tsx web/app/inbox/lead-inbox.tsx web/components/ui/badge.tsx web/components/ui/select.tsx
git commit -m "feat: build lead inbox with score filter and status control"
```

---

### Task 5: Day 2 End-to-End Verification (Happy Path)

**Files:** none — this is a verification-only task, gated on the Bynara account having credits.

**Interfaces:**
- Consumes: everything above, plus a real ICP row (create one via the Day 1 onboarding flow) and a funded Bynara key in both function `.env` files.

- [ ] **Step 1: Confirm prerequisites**

- `pnpm exec supabase status` shows the stack running.
- Both `supabase/functions/generate-icp/.env` and `supabase/functions/score-lead/.env` contain the real `BYNARA_API_KEY`.
- The Bynara account has a non-zero credit balance (a 0 balance returns `payment_required` and every LLM call fails).
- At least one user has completed Day 1 onboarding, so an `icps` row exists. Capture that user's id:
  ```bash
  docker exec supabase_db_Glint psql -U postgres -d postgres -t -c \
    "select user_id from public.icps order by created_at limit 1;"
  ```

- [ ] **Step 2: Serve the functions**

```bash
pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env
```

- [ ] **Step 3: Score a lead end-to-end**

Replace `<user-id>` with the id from Step 1 and `<anon-key>` from `supabase status`:

```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/score-lead" \
  -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" \
  -d '{"user_id":"<user-id>","profile_data":{"name":"Dana Lee","headline":"VP of Sales","company":"Acme SaaS","post_text":"We just doubled our SDR team and need better outbound tooling.","linkedin_url":"https://linkedin.com/in/danalee","source":"post"}}'
```
Expected: `HTTP/1.1 200`, body `{"lead_id":"…","match_score":<0-100>,"match_reasons":[…]}`.

- [ ] **Step 4: Confirm it landed in the inbox**

Visit `http://localhost:3000/inbox` signed in as that user.
Expected: the "Dana Lee" lead appears with its score badge and reasons; status change persists across reload.

- [ ] **Step 5: Confirm the row in the database**

```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -c \
  "select name, match_score, status, source from public.leads order by created_at desc limit 1;"
```
Expected: the "Dana Lee" row with the returned score, `status = new`, `source = post`.

No commit — verification only.

---
```
