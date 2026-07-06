# LinkedIn Lead Gen Tool — Build Plan

**Timeline:** 5 days
**Stack:** Next.js (Vercel) + Supabase + Chrome Extension (WXT)

---

## 1. Product Summary

A LinkedIn lead generation tool for founders, agencies, and solo operators doing outbound sales.

- User adds their website URL → AI generates their ICP (target role, company type, pain points)
- User installs a Chrome extension and pairs it with the web app
- User sets a keyword + reviews their ICP in the web app
- User browses LinkedIn normally in their own browser; the extension reads what's already rendered on screen (feed posts, search results, profiles) and scores it against the ICP in real time
- Strong matches (name, company, post context, LinkedIn URL, score) sync instantly into a lead inbox in the web app
- User reaches out manually with full context in front of them

**Explicitly not building:** LinkedIn OAuth/account connection, autonomous multi-tab crawling, proxy-based scraping infrastructure. See Section 6 for why.

---

## 2. Architecture

```
┌───────────────────┐      ┌────────────────────┐      ┌──────────────────┐
│  Chrome Extension   │      │     Supabase          │      │   Next.js Web App   │
│  (WXT + React + TS)  │─────▶│  - Postgres            │◀─────│   (Vercel)            │
│                       │      │  - Auth (shared)        │      │                        │
│  content script:      │      │  - Edge Functions        │      │  - ICP wizard           │
│  reads visible DOM     │      │  - Realtime               │      │  - Lead inbox (realtime) │
│  as user browses        │      │                             │      │  - Settings/pairing       │
└───────────────────┘      └────────────────────┘      └──────────────────┘
```

**Data flow per scored item:**
1. Content script detects a profile card or post already rendered on the page (triggered by user's own scroll/click — extension does not navigate on its own)
2. Extracts: name, headline, company, post text, LinkedIn URL
3. POSTs to Supabase Edge Function `score-lead` with `{ profile_data, user_id }`
4. Edge Function fetches the user's ICP from `icps`, calls Claude with structured output (score 0–100 + reasoning), inserts into `leads`
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

create table scan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  keyword text,
  leads_found int default 0,
  created_at timestamptz default now()
);

create table extension_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  pairing_token text unique not null,
  expires_at timestamptz,
  paired_at timestamptz
);
```

Enable Row Level Security on all tables, scoped to `auth.uid() = user_id`.

---

## 4. Extension Approach — Option A (Passive Scan) + Middle-Ground Auto-Scroll

### Baseline: Option A (lowest risk, ship this first)
- User browses LinkedIn normally — searches their own keyword, scrolls, opens profiles
- Content script uses a `MutationObserver` on the feed/results container to detect newly rendered nodes
- No `chrome.tabs.create`, no programmatic navigation — extension is a passenger, not a driver
- This is the core, shippable product for Day 3–4

### Optional stretch: foreground-tab auto-scroll
If "click run and don't manually scroll" is a hard requirement, add this on top — but note the tradeoff: this shifts closer to Option B's risk profile since the extension is now moving the page, not the user.

- Only scrolls the active foreground tab the user already has open — never opens new tabs or scrolls in the background
- Randomized pacing: variable delay between scrolls, non-uniform scroll distances, occasional pauses — avoid fixed-interval loops
- Hard session caps: stop after N profiles or M minutes
- Auto-pause if the tab loses focus or the user switches away
- Ship this only after the passive baseline works — treat it as an enhancement, not the MVP

**Explicitly out of scope:** autonomous multi-tab crawling, headless browser automation, proxy-based IP rotation to evade detection. These shift real ban risk onto the user's LinkedIn account regardless of how "disconnected" the platform stays from LinkedIn — see Section 6.

---

## 5. Extension Framework: WXT

- File-based entrypoints (`entrypoints/popup`, `entrypoints/content.ts`, `entrypoints/background.ts`) — WXT auto-generates the manifest
- Vite-based — fast HMR, small bundle size
- Cross-browser build support (Chrome first, Firefox/Safari later at no extra architectural cost)
- React + TypeScript + Tailwind for popup/options UI

```
extension/
├── entrypoints/
│   ├── popup/           # pairing status, start/stop toggle, session stats
│   ├── content.ts        # DOM reader + MutationObserver, badge injection
│   ├── background.ts      # message relay, pairing token storage
│   └── options/           # settings page
├── public/
└── wxt.config.ts
```

---

## 6. Extension ↔ Web App Pairing/Auth

**No LinkedIn OAuth. No LinkedIn credentials touch your servers.** The extension only ever needs to know which of *your* platform's users it belongs to.

1. User logs into the web app normally (Supabase Auth)
2. Dashboard shows "Connect Extension" → generates a short-lived `pairing_token` in `extension_pairings`, displayed as a one-time code or deep link
3. Extension popup has a "Pair" field — user pastes the code, or clicks the deep link which opens the extension and passes the token
4. Extension stores the token in `chrome.storage.local`, exchanges it for a long-lived session via an Edge Function, and uses that to authenticate all future `score-lead` requests
5. Token can be revoked from the web app settings page at any time

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

### Day 1 — Web app skeleton + ICP generation
- Next.js + Supabase Auth scaffolded, Vercel deploy pipeline live immediately
- Onboarding flow: URL input → Edge Function fetches site content → Claude generates structured ICP JSON → user reviews/edits → saves to `icps`

### Day 2 — Lead inbox UI + scoring Edge Function
- `leads` table + inbox UI (list, filter by score, status toggle: new/contacted/ignored)
- `/functions/score-lead`: takes scraped profile/post text + ICP, returns score + reasoning via Claude structured output
- Test directly with curl/Postman before touching the extension

### Day 3 — Extension MVP (WXT)
- `wxt init`, React + Tailwind, manifest permissions for `linkedin.com/*`
- Content script: selectors for profile pages and feed posts, `MutationObserver` for passive detection
- Pairing flow: token exchange, `chrome.storage.local`

### Day 4 — Wire extension to backend + inline UI
- POST scraped data to `score-lead`, render inline score badge on LinkedIn profiles/posts
- Confirm leads appear in the web inbox via Supabase Realtime subscription:

```ts
supabase
  .channel('leads-inbox')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` },
    (payload) => addLeadToInbox(payload.new)
  )
  .subscribe()
```

### Day 5 — Polish, edge cases, ship
- Rate limiting / debounce on rapid scroll to avoid hammering the Edge Function
- Graceful failure when LinkedIn's DOM selectors break (expect this — don't crash the badge UI)
- Chrome Web Store submission (review takes days — submit even if imperfect)
- Landing page copy, demo video, build-in-public post

---

## 9. Known Risk Areas to Watch

- **LinkedIn DOM instability** — selectors will break periodically; build the content script to fail silently and log rather than crash
- **Ban risk is behavioral, not architectural** — no amount of "not connecting the account" removes it; passive scan keeps this close to zero, auto-scroll raises it somewhat, full automation raises it significantly
- **Pairing token expiry/revocation** — make sure a revoked token immediately stops the extension from posting data
- **Scope creep on Day 3** — if behind schedule, cut to profile-page scanning only and skip feed-post scanning; profiles are more DOM-stable than the infinite-scroll feed