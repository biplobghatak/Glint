# SaaS App Shell & Dashboard

**Status:** Approved for implementation planning
**Scope:** Redesign the authenticated part of the web app (currently `/inbox` and `/settings`, each rendering a bare centered column under a plain top nav) into a proper SaaS shell — persistent sidebar, header with search/theme/user menu — plus a new `/dashboard` overview page. Landing page, login/signup, and onboarding are untouched.

---

## 1. Context

Today, `/inbox` and `/settings` each independently render `<AppNav />` (a thin sticky top bar: logo, two text links, a plain "Sign out" button) followed by a `max-w-3xl` centered column. There is no dashboard/overview page — `/` redirects logged-in users straight to `/inbox`. There's no sidebar, no stat tiles, no user menu, no visible theme toggle (only a `d` hotkey), and no search/sort in the Inbox beyond a score-bucket filter.

The underlying design system is already solid — shadcn (`style: radix-sera`, neutral base color) with full light/dark CSS variable tokens in `globals.css`, `next-themes` wired via `ThemeProvider`, and Tailwind v4. The gap is entirely in app *structure* (shell/navigation/overview), not in missing design tokens.

Goal: make the authenticated app read as a fully-fledged SaaS product — sidebar navigation, a real dashboard, and header-level functionality (search, sort, theme toggle, user menu) — without touching the underlying data model or the Inbox's realtime/status-update logic.

---

## 2. Architecture

### Route grouping
`app/dashboard/`, `app/inbox/`, and `app/settings/` move under a shared route group `app/(app)/` (route groups don't affect the URL, so `/dashboard`, `/inbox`, `/settings` are unchanged). A single `app/(app)/layout.tsx`:

- Does the `supabase.auth.getUser()` check + `redirect("/login")` once, instead of it being duplicated in every page.
- Fetches the minimal user info needed for the header (email) and passes it to `AppShell`.
- Renders `<AppShell>{children}</AppShell>`.

This replaces the current per-page `<AppNav />` pattern. `components/app-nav.tsx` is deleted; its logic (nav links, sign out) is absorbed into the new shell components below.

### `AppShell` (`components/app-shell/`)
- **`sidebar.tsx`** — persistent left rail on desktop (`md:` and up): logo/wordmark at top, nav items with lucide icons (`LayoutDashboard`, `Inbox`, `Settings`), active-state highlight via `usePathname()`. On mobile (below `md`), the sidebar content renders inside a shadcn `Sheet` triggered by a hamburger button in the header.
- **`header.tsx`** — sticky header inside the content area (not full page width, so it aligns with the sidebar-offset content column): page title (derived from a small `pageTitle` prop each page passes in, since Next doesn't give this for free), a `children`/slot for page-specific controls (Inbox's search input renders here), a theme-toggle icon button, and a user-avatar → `DropdownMenu` (shows email, has a "Sign out" item wired to the existing `supabase.auth.signOut()` + `router.push("/login")` + `router.refresh()` logic moved over verbatim from `app-nav.tsx`).
- **`app-shell.tsx`** — composes sidebar + header + `<main>{children}</main>`, handling the responsive layout (fixed sidebar width on desktop via CSS grid/flex, full-width content with drawer on mobile).

### New shadcn components
Pull in via `pnpm dlx shadcn@latest add card dropdown-menu avatar separator sheet` (matches the existing `components.json` config — `radix-sera` style, neutral base, `lucide` icons). No other new dependencies.

### Theme toggle
A header icon button using `useTheme()` from `next-themes` (already installed), cycling `light` ↔ `dark`. Wired independently of the existing `d` keyboard shortcut in `theme-provider.tsx` — both control the same `next-themes` state, so they naturally stay in sync (no changes needed to `theme-provider.tsx`).

### Redirect update
`app/page.tsx`: the authenticated-with-ICP branch changes `redirect("/inbox")` → `redirect("/dashboard")`.

---

## 3. Dashboard (`app/(app)/dashboard/`)

**`page.tsx`** (server component):
- Auth/user already available from the shared `(app)/layout.tsx` — re-derives user via `createClient()` server helper as other pages do (Next server components don't share request-scoped data across layout/page without extra plumbing, and this query is cheap).
- Runs three scoped reads against the existing `leads` table (no new tables/migrations):
  - Total count for the user.
  - Counts grouped by `status` (`new` / `contacted` / `ignored`) — via `count: "exact"` queries per status (three small queries; the `leads` table is per-user and small, so this is simpler and clear enough vs. a Postgres RPC/view for this volume).
  - Average `match_score` — computed client-side (in the server component, before render) from a lightweight `select("match_score")` over the user's leads, since Supabase's JS client doesn't do server-side `avg()` without an RPC, and introducing an RPC is unwarranted for this data size.
- Fetches the user's `icps` row (`target_roles, company_types, pain_points, raw_summary`) — same shape already used in onboarding.
- Fetches the 5 most recent leads (`order by created_at desc limit 5`) for the "Recent leads" card.

**`dashboard-view.tsx`** (client presentational component, mirrors the `lead-inbox.tsx` split of server-fetch/client-render):
- **Stat tile row** — 4 `Card`s: Total leads, New, Contacted, Avg match score. If total leads is 0, this row is replaced entirely by an empty state (see below) rather than showing four zeroed tiles.
- **"Your ICP" card** — target roles / company types / pain points rendered as `Badge` pills (reusing the existing `Badge` component), each in its own labeled group; no edit action (view-only, per scope).
- **"Recent leads" card** — up to 5 rows (name, company · role, score `Badge`), each linking out via `linkedin_url` same as Inbox; a "View all →" link to `/inbox` at the card's footer. If empty, the card shows "No leads yet."
- **Empty state** (0 total leads): a single centered `Card` — "No leads yet. Connect the extension to start scoring leads." with a button linking to `/settings`. The "Your ICP" card still renders if an `icps` row exists (it always will post-onboarding), since it's independent of lead data.

---

## 4. Inbox restyle (`app/(app)/inbox/`)

`lead-inbox.tsx`'s realtime subscription (`postgres_changes` on `leads` INSERT) and `updateStatus` optimistic-update logic are unchanged. Changes are presentational + added client-side filtering:

- **Search input** — new `useState<string>` for a query string; a lead is visible if it matches the current score-filter bucket **and** (query is empty or matches name/company/role case-insensitively). Pure client-side `.filter()`, no new query.
- **Sort control** — a `Select` (score dependencies already imported) with options Score ↓ (default, matches current `order by match_score desc` from the initial server fetch), Score ↑, Newest, Oldest — applied client-side via `.sort()` on the already-filtered array, computed in the same `useMemo` as `visible`.
- **Score filter** — same four buckets, restyled as a segmented control (single bordered group, active segment filled) instead of separate outline/default buttons.
- **Lead rows** — replaced with `Card` components; a 3px left border colored by score bucket (green/amber/neutral, reusing bucket logic already in `scoreVariant`) replaces the plain uniform border, giving at-a-glance scannability in a longer list.
- **Layout** — the page's own `max-w-3xl` wrapper is removed; width is now governed by `AppShell`'s content column, so Inbox and Dashboard share consistent margins instead of Inbox looking like a narrower floating column.
- **Header integration** — the search input is passed as `header`'s slot content from `inbox/page.tsx`/`lead-inbox.tsx` so it visually sits in the header bar per the approved design, not floating in the page body.

---

## 5. Settings restyle (`app/(app)/settings/`)

`pairing-panel.tsx`'s logic (`generate`, `revoke`, `loadPairings`) is unchanged. The "Generate pairing code" section and "Paired devices" list each move into a `Card`, consistent with Dashboard/Inbox's new card-based visual language. No new fields or actions.

---

## 6. Error Handling

- Dashboard's three count queries and the ICP fetch each independently default to a safe empty value (`0`, `null`, `[]`) if Supabase returns an error, rather than throwing — the dashboard should degrade to showing zeroed/empty cards, not crash, since this is a read-only overview.
- No new failure modes are introduced in Inbox/Settings — existing error handling (optimistic-update rollback on `updateStatus` failure) is untouched.

---

## 7. Testing

- **Manual QA** (no automated test suite currently exists for `web/` beyond `typecheck`/`lint`): verify `pnpm typecheck` and `pnpm lint` pass after the restructure; click through Dashboard (with and without leads seeded), Inbox (search + sort + filter combinations, realtime insert still updates the list), Settings (generate/revoke still work), and confirm the sidebar collapses correctly at mobile width and the theme toggle + `d` hotkey both work and stay in sync.
- Since moving pages into a route group is a structural refactor, confirm all three routes (`/dashboard`, `/inbox`, `/settings`) still resolve correctly and unauthenticated access still redirects to `/login`.

---

## 8. Explicitly Out of Scope

- No new database tables, columns, or migrations — Dashboard stats are read-only queries against the existing `leads` and `icps` tables.
- No ICP editing from the Dashboard (view-only card).
- No placeholder/stub sidebar sections (e.g. Analytics, Billing) — sidebar only lists real, functional pages.
- Landing page (`components/landing.tsx`), login/signup (`auth-form.tsx`), and onboarding flow are untouched.
- No changes to Inbox's realtime subscription or status-update semantics — restyle only.
