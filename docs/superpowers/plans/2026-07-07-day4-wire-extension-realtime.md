# Day 4 — Wire Extension to Backend, Inline Badges & Realtime Inbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop — the content script scores each detected LinkedIn lead through `score-lead` (authenticated by device token), draws the score inline on the card, and scored leads appear live in the web inbox via Supabase Realtime.

**Architecture:** `score-lead` stops trusting a body `user_id`; the extension sends its **device token**, and `score-lead` resolves `user_id` from `extension_pairings`. The content script debounces rapid scroll, sends each unique candidate once, and injects a small inline badge (all-inline styles, no CSS bleed) showing the returned score. The inbox subscribes to `postgres_changes` INSERTs on `leads` filtered to the signed-in user and prepends new rows with no reload.

**Tech Stack:** Deno Edge Functions, WXT content script + `fetch`, `@supabase/supabase-js` Realtime channel in the Next.js client, Supabase logical replication publication `supabase_realtime`.

All paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **`score-lead` identity is the device token only.** No endpoint accepts a client-provided `user_id` anymore. Invalid/missing token → 401.
- **Inline badge styles are 100% inline** on the injected node (no external stylesheet, no Tailwind in the content script) so LinkedIn's CSS cannot bleed in or out. Badge injection must fail soft — never throw into LinkedIn's page.
- **One score per unique candidate** — the content script dedupes (Day 3's `seen` set) and debounces bursts; never re-score the same card.
- **Realtime is filtered to the user** — `filter: user_id=eq.<uid>`; RLS still applies to the initial read.
- **No automated tests** — manual verification, batched into the Day 4/5 end-to-end run (needs Docker + Bynara credits).
- Reuse Day 3's `extension/lib/extract.ts` and pairing token storage; do not duplicate extraction or token logic.

---

### Task 1: Add `leads` to the Realtime Publication

**Files:**
- Create: `supabase/migrations/<timestamp>_leads_realtime.sql`

**Interfaces:**
- Produces: `public.leads` added to the `supabase_realtime` publication so INSERTs broadcast.

- [ ] **Step 1: Create the migration**

Run (repo root): `pnpm exec supabase migration new leads_realtime`

- [ ] **Step 2: Write it**

```sql
alter publication supabase_realtime add table public.leads;
```

- [ ] **Step 3: Apply + verify**

Run: `pnpm exec supabase migration up`
```bash
docker exec supabase_db_Glint psql -U postgres -d postgres -t -c \
  "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='leads';"
```
Expected: `leads`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add leads table to realtime publication"
```

---

### Task 2: Harden `score-lead` to Device-Token Auth

**Files:**
- Modify: `supabase/functions/score-lead/index.ts`

**Interfaces:**
- Consumes: `POST { profile_data, device_token }` (replaces `user_id`). Resolves `user_id` via `extension_pairings.device_token`.
- Produces: same success shape `{ lead_id, match_score, match_reasons }`; `401 { error: "unpaired" }` when the token is missing or unknown.

- [ ] **Step 1: Replace the body parse + identity block**

In `supabase/functions/score-lead/index.ts`, change the body type and the `user_id` resolution. Replace the block from `const { profile_data, user_id } = body` through the ICP fetch's start with:

```ts
  const { profile_data, device_token } = body as {
    profile_data?: ProfileData
    device_token?: string
  }
  if (!device_token || !profile_data) {
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
```

Also update the top `let body` type annotation to `{ profile_data?: ProfileData; device_token?: string }`. The rest (ICP fetch by `user_id`, scoring, insert) is unchanged.

- [ ] **Step 2: Verify unpaired path (no credits needed)**

```bash
pnpm exec supabase functions serve --env-file supabase/functions/score-lead/.env
```
```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/score-lead" \
  -H "Content-Type: application/json" \
  -d '{"device_token":"bogus","profile_data":{"name":"X"}}'
```
Expected: `HTTP/1.1 401`, `{"error":"unpaired"}`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/score-lead/index.ts
git commit -m "refactor: authenticate score-lead by device token"
```

---

### Task 3: Extension — Score & Inline Badge

**Files:**
- Create: `extension/lib/score.ts`
- Modify: `extension/entrypoints/linkedin.content.ts`

**Interfaces:**
- Consumes: `getDeviceToken` from `@/lib/pairing`; `extractFromNode`, `LeadCandidate` from `@/lib/extract`; the `score-lead` endpoint.
- Produces: `scoreLead(candidate)` → `{ match_score, match_reasons } | null`; the content script scores each unique candidate (debounced) and injects a badge onto its card.

- [ ] **Step 1: Write the scoring lib**

`extension/lib/score.ts`:

```ts
import { getDeviceToken } from "@/lib/pairing"
import type { LeadCandidate } from "@/lib/extract"

const env = import.meta.env as unknown as Record<string, string>

export type ScoreResult = { match_score: number; match_reasons: string[] }

export async function scoreLead(
  candidate: LeadCandidate
): Promise<ScoreResult | null> {
  const device_token = await getDeviceToken()
  if (!device_token) return null

  try {
    const res = await fetch(
      `${env.WXT_SUPABASE_URL}/functions/v1/score-lead`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.WXT_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          device_token,
          profile_data: {
            name: candidate.name,
            headline: candidate.headline,
            company: candidate.company,
            post_text: candidate.post_text,
            linkedin_url: candidate.linkedin_url,
            source: candidate.source,
          },
        }),
      }
    )
    if (!res.ok) return null
    return (await res.json()) as ScoreResult
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Rewrite the content script to score + badge**

`extension/entrypoints/linkedin.content.ts`:

```ts
import { extractFromNode, type LeadCandidate } from "@/lib/extract"
import { scoreLead } from "@/lib/score"

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    const seen = new Set<string>()
    const queue: { node: Element; cand: LeadCandidate }[] = []
    let draining = false

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
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

    async function drain() {
      if (draining) return
      draining = true
      while (queue.length) {
        const { node, cand } = queue.shift()!
        const result = await scoreLead(cand)
        if (result) injectBadge(node, result.match_score, result.match_reasons)
        await new Promise((r) => setTimeout(r, 400)) // rate-limit
      }
      draining = false
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
  },
})
```

- [ ] **Step 3: Typecheck + build**

Run (cwd `extension/`): `pnpm compile && pnpm build`
Expected: no TS errors; builds `content-scripts/linkedin.js`.

- [ ] **Step 4: Commit**

```bash
git add extension/lib/score.ts extension/entrypoints/linkedin.content.ts
git commit -m "feat: score LinkedIn candidates and inject inline badges"
```

---

### Task 4: Realtime Inbox Subscription

**Files:**
- Modify: `web/app/inbox/lead-inbox.tsx`

**Interfaces:**
- Consumes: the browser Supabase client's Realtime channel; the existing `Lead` type.
- Produces: the inbox prepends any newly inserted lead for the current user without a reload.

- [ ] **Step 1: Add the subscription**

In `web/app/inbox/lead-inbox.tsx`, add `useEffect` (import it) after the existing state. It needs the user id; pass it in. First update `page.tsx` to pass `userId={user.id}` to `<LeadInbox>`, add `userId: string` to the component props, then:

```tsx
useEffect(() => {
  const channel = supabase
    .channel("leads-inbox")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "leads",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        setLeads((cur) => {
          const lead = payload.new as Lead
          if (cur.some((l) => l.id === lead.id)) return cur
          return [lead, ...cur]
        })
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [supabase, userId])
```

Add `import { useEffect, useMemo, useState } from "react"` (add `useEffect`).

- [ ] **Step 2: Update `page.tsx` to pass userId**

In `web/app/inbox/page.tsx`, change the render to `<LeadInbox initialLeads={(leads ?? []) as Lead[]} userId={user.id} />`, and in `lead-inbox.tsx` change the signature to `export function LeadInbox({ initialLeads, userId }: { initialLeads: Lead[]; userId: string })`.

- [ ] **Step 3: Build**

Run (cwd `web/`): `pnpm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add web/app/inbox/lead-inbox.tsx web/app/inbox/page.tsx
git commit -m "feat: live-update inbox via Supabase Realtime"
```

---

### Task 5: End-to-End Verification (gated on Docker + Bynara credits)

- [ ] Stack up, functions served, `web` dev running, extension loaded unpacked, and paired (Day 3 Task 6). An ICP row exists.
- [ ] On LinkedIn: run a people search / scroll the feed → badges appear on cards within a second or two, colored by score.
- [ ] The web `/inbox` (open in another tab) shows those same leads appear live, no reload.
- [ ] `select count(*) from leads` increases; scores match the badges.
- [ ] Unpair in the popup → new cards stop getting badges (score-lead returns 401).
```
