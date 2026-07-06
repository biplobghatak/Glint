# Day 1 — Web App Skeleton + ICP Generation

**Status:** Approved for implementation planning
**Parent plan:** `PLAN.md` (5-day LinkedIn lead gen tool)
**Scope:** Web app shell, auth, and the ICP onboarding flow only. Leads, scoring, extension pairing, and the Chrome extension itself are out of scope — each gets its own spec in a later brainstorming pass.

---

## 1. Context

`PLAN.md` lays out a 5-day build for a LinkedIn lead-gen tool (Next.js + Supabase + Chrome extension). A gap-review of that plan surfaced several undecided or underspecified items; the ones relevant to this slice of work are resolved below. Items relevant to later days (dedup strategy for `leads`, extension auth token design, `scan_sessions` linkage) are recorded here for continuity but implemented in their own specs.

**Decisions carried over from the gap review, for later specs:**
- Duplicate lead ingestion: normalize `linkedin_url`, unique constraint on `(user_id, linkedin_url)`, upsert-on-conflict.
- Extension auth: Supabase-signed short-TTL JWT minted by an exchange Edge Function, re-checked against `extension_pairings` revocation/expiry state on each mint.
- `leads.scan_session_id` (nullable FK) links leads to the session active when they were captured; `scan_sessions.leads_found` increments via a DB trigger on insert.
- Chrome Web Store review risk and third-party-data privacy posture are known considerations, not implementation blockers — revisit before Day 5 submission.

---

## 2. Stack & Setup

- **Frontend/hosting:** Next.js (App Router), deployed to Vercel from the first commit so every push gets a preview URL.
- **Backend:** Supabase project — Postgres, Auth, Edge Functions.
- **Auth method:** Magic link / OTP via Supabase Auth. User enters an email, clicks the emailed link, lands authenticated. No password fields, no reset-password flow to build. Uses Supabase's default email delivery for the MVP.
- **UI components:** shadcn/ui, scaffolded via `pnpm dlx shadcn@latest init --preset b6AUm6lTwO --base radix --template next` — Radix-based components with the project's brand color preset applied through CSS variables in `app/globals.css`. Lives in `web/` at the repo root, as a sibling to the future `extension/` directory from Section 5 of `PLAN.md`.

---

## 3. Data Model (this spec's slice)

```sql
create table icps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  website_url text not null,
  target_roles text[],
  company_types text[],
  pain_points text[],
  raw_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

- Row Level Security enabled: all operations scoped to `auth.uid() = user_id`.
- One ICP per user for the MVP — editing the ICP updates the existing row rather than inserting a new one. The onboarding/settings UI treats it as a single object, not a list.

---

## 4. Onboarding Flow

1. User signs in via magic link.
2. If no `icps` row exists for the user, route to onboarding. Otherwise route to the (Day-2) lead inbox, which will render empty until that spec lands.
3. User enters their website URL.
4. Client calls Supabase Edge Function `generate-icp` with `{ website_url }`.
5. Edge Function fetches the URL, strips HTML down to readable text (tags/scripts/nav removed), and calls Claude with structured output to produce `{ target_roles, company_types, pain_points, raw_summary }`.
6. **Fallback path:** if the fetch fails, times out, or the extracted text is under 200 characters after stripping (e.g. a JS-rendered SPA returning an empty shell), the Edge Function responds with a `needs_manual_input` flag instead of an error. The UI then shows a textarea ("Tell us about your product instead"), and that text is sent to Claude in place of scraped content.
7. The returned structured JSON renders as an editable review screen — roles / company types / pain points as editable list fields, summary as an editable text block.
8. User edits as needed and saves → upserts into `icps`.

---

## 5. Error Handling

- **Invalid/malformed URL:** validated client-side before calling the Edge Function.
- **Claude API failure** (rate limit, timeout, malformed structured response): show a retry action; do not silently fail the step.
- **Edge Function failure:** generic retry messaging. No partial `icps` row is written until the user explicitly saves the reviewed ICP.

---

## 6. Testing (Day 1 scope)

- Manual: curl `generate-icp` directly against a handful of real marketing sites — at least one standard server-rendered site and one JS-heavy SPA — to confirm both the happy path and the `needs_manual_input` fallback trigger correctly, before wiring the UI to it.
- No automated test suite for this slice, consistent with the parent plan's overall testing posture for the 5-day MVP.

---

## 7. Explicitly Out of Scope

`leads`, `scan_sessions`, `extension_pairings` tables; the Chrome extension; the `score-lead` Edge Function. These are covered in later specs corresponding to Days 2–4 of `PLAN.md`.
