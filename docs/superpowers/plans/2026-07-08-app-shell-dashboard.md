# SaaS App Shell & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current bare top-nav + centered-column layout with a real SaaS app shell (persistent sidebar, header with theme toggle + user menu), add a new `/dashboard` overview page, and restyle Inbox/Settings to match.

**Architecture:** `web/app/dashboard/`, `web/app/inbox/`, `web/app/settings/` move under a new route group `web/app/(app)/` with a single shared `layout.tsx` that does the auth check once and wraps everything in an `AppShell` (`web/components/app-shell/`). All new interactive primitives (Card, Separator, Avatar, DropdownMenu, Sheet) are hand-written directly on top of the already-installed unified `radix-ui` package, mirroring the exact pattern this repo's existing `select.tsx`/`badge.tsx`/`label.tsx` already use — no new npm dependencies, no `shadcn` CLI network calls. Page-specific controls (Inbox's search/sort) render in a per-page `PageHeader` row inside the page content, not injected into the shared header, avoiding any Next.js layout↔page prop-passing complexity.

**Tech Stack:** Next.js 16.2.6 App Router, React 19, `radix-ui` (unified package, already installed), Tailwind CSS v4, `next-themes`, `@supabase/ssr`, pnpm.

All file paths are relative to the repo root, `D:\Projects\Glint`.

## Global Constraints

- **Visual language: `rounded-none` everywhere, no new color tokens.** Every existing UI primitive (`button.tsx`, `badge.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`) hardcodes `rounded-none` and reuses the CSS variables already defined in `web/app/globals.css` (`--card`, `--popover`, `--sidebar*`, `--primary`, etc.). All new primitives and components in this plan follow the same convention — square corners, no new CSS variables.
- **No new npm dependencies.** `web/package.json` already has `"radix-ui": "^1.6.1"`, a single unified package exporting every primitive as a named export (e.g. `import { DropdownMenu, Avatar, Separator, Dialog } from "radix-ui"`). New primitives (Card, Separator, Avatar, DropdownMenu, Sheet) are hand-written on top of this, copying the wrapper pattern already used by `web/components/ui/select.tsx` and `web/components/ui/label.tsx`. Do not run `pnpm dlx shadcn add` or install anything new.
- **Icon names use the `Icon`-suffixed lucide-react exports** (e.g. `MenuIcon`, `SunIcon`, `MoonIcon`, `LogOutIcon`, `LayoutDashboardIcon`, `InboxIcon`, `SettingsIcon`, `XIcon`), matching the existing convention in `select.tsx` (`ChevronDownIcon`, `CheckIcon`, `ChevronUpIcon`). Both suffixed and unsuffixed names exist in the installed `lucide-react` version — always use the suffixed form for consistency.
- **No `useEffect` + synchronous `setState` for mount-guards.** This repo's ESLint config (`eslint-config-next` on `eslint-plugin-react-hooks@7`) enables the `react-hooks/set-state-in-effect` rule, which is an **error**, not a warning, and fires even through an async wrapper function (confirmed empirically — see Task 2). It does **not** fire when `setState` is called from an event-listener or subscription *callback* (confirmed: `theme-provider.tsx`'s existing `ThemeHotkey` and `lead-inbox.tsx`'s realtime subscription both already pass). The theme toggle in this plan avoids the pattern entirely by rendering both Sun/Moon icons and toggling visibility with the `dark:` Tailwind variant — no effect needed.
- **Known pre-existing lint failure, out of scope.** `pnpm lint` currently fails on `web/app/settings/pairing-panel.tsx` — `react-hooks/set-state-in-effect` on the `loadPairings()` call inside its `useEffect`. This exists before this plan and is unrelated to the UI redesign; **do not fix it**. Every task's lint-verification step in this plan expects **zero errors in any file this plan touches**, and separately notes this one pre-existing error is expected to still appear when `pairing-panel.tsx` is linted (by whatever path it's currently at in that task).
- **No new database tables, columns, or migrations.** The Dashboard's stats are read-only queries against the existing `leads` and `icps` tables (schemas: `supabase/migrations/20260706122941_create_leads_table.sql`, `supabase/migrations/20260703190526_create_icps_table.sql`).
- **No ICP editing UI, no placeholder/stub sidebar links.** The sidebar only ever links to `/dashboard`, `/inbox`, `/settings` — all real, functional pages.
- **Landing page, login/signup, and onboarding are untouched.** Only `web/app/dashboard/`, `web/app/inbox/`, `web/app/settings/`, `web/app/page.tsx`, and `web/components/app-nav.tsx` (deleted) are in scope.
- **Verification commands run with cwd `web/`:** `pnpm typecheck` (runs `tsc --noEmit`) and `pnpm lint` (runs `eslint`). The final task additionally runs `pnpm run build` and a manual click-through via `pnpm dev`.
- **No automated test suite exists for `web/`** beyond `typecheck`/`lint` — this matches the existing project's testing posture (see `docs/superpowers/plans/2026-07-06-day2-leads-scoring-inbox.md`'s Global Constraints). Every task is verified via `pnpm typecheck` + `pnpm lint`, plus a manual `pnpm dev` check for any task that changes rendered behavior.

---

### Task 1: New UI Primitives (Card, Separator, Avatar, DropdownMenu, Sheet)

**Files:**
- Create: `web/components/ui/card.tsx`
- Create: `web/components/ui/separator.tsx`
- Create: `web/components/ui/avatar.tsx`
- Create: `web/components/ui/dropdown-menu.tsx`
- Create: `web/components/ui/sheet.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; `Separator`, `Avatar`, `DropdownMenu`, `Dialog` named exports from `radix-ui`; `XIcon` from `lucide-react`.
- Produces (consumed by Tasks 2, 3, 6, 7, 8):
  - `Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter` from `@/components/ui/card` — each `React.ComponentProps<"div">` with a `className` override.
  - `Separator` from `@/components/ui/separator` — `React.ComponentProps<typeof SeparatorPrimitive.Root>`.
  - `Avatar, AvatarImage, AvatarFallback` from `@/components/ui/avatar`.
  - `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator` from `@/components/ui/dropdown-menu`.
  - `Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle` from `@/components/ui/sheet` — `Sheet` accepts `open`/`onOpenChange` (it's `Dialog.Root` under the hood).

- [ ] **Step 1: Write the Card primitive**

`web/components/ui/card.tsx`:

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-6 border border-border bg-card py-6 text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-6", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-xs font-semibold tracking-wider text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-6", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6", className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
```

- [ ] **Step 2: Write the Separator primitive**

`web/components/ui/separator.tsx`:

```tsx
"use client"

import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
```

- [ ] **Step 3: Write the Avatar primitive**

`web/components/ui/avatar.tsx`:

```tsx
"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden border border-border bg-secondary",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center text-xs font-semibold text-secondary-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
```

- [ ] **Step 4: Write the DropdownMenu primitive**

`web/components/ui/dropdown-menu.tsx`:

```tsx
"use client"

import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = "end",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-none bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-none px-3 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        "px-3 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-border/50", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
}
```

- [ ] **Step 5: Write the Sheet primitive**

`web/components/ui/sheet.tsx`:

```tsx
"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full w-72 flex-col border-r border-border bg-sidebar text-sidebar-foreground shadow-lg data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle }
```

- [ ] **Step 6: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: both succeed with zero errors (these are new, unused-so-far files — typecheck/lint check them in isolation for syntax/type correctness).

- [ ] **Step 7: Commit**

```bash
git add web/components/ui/card.tsx web/components/ui/separator.tsx web/components/ui/avatar.tsx web/components/ui/dropdown-menu.tsx web/components/ui/sheet.tsx
git commit -m "feat: add Card, Separator, Avatar, DropdownMenu, and Sheet UI primitives"
```

---

### Task 2: Header Controls — Theme Toggle & User Menu

**Files:**
- Create: `web/components/app-shell/theme-toggle.tsx`
- Create: `web/components/app-shell/user-menu.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button`; `useTheme` from `next-themes`; `Avatar, AvatarFallback`, `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator` from Task 1; `createClient` from `@/lib/supabase/client`; `useRouter` from `next/navigation`.
- Produces (consumed by Task 4):
  - `ThemeToggle` (no props) from `@/components/app-shell/theme-toggle`.
  - `UserMenu({ email }: { email: string })` from `@/components/app-shell/user-menu`.

- [ ] **Step 1: Write the theme toggle**

`web/components/app-shell/theme-toggle.tsx`:

```tsx
"use client"

import { useTheme } from "next-themes"
import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      className="relative"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
    </Button>
  )
}

export { ThemeToggle }
```

This deliberately avoids a `useEffect`-based "mounted" guard (see Global Constraints) — both icons render identically on server and client, and only the `dark:` variant (driven by the `.dark` class `next-themes` applies before hydration) decides which is visible, so there's no hydration mismatch and no lint violation.

- [ ] **Step 2: Write the user menu**

`web/components/app-shell/user-menu.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { LogOutIcon } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function initialsFromEmail(email: string): string {
  return email.slice(0, 2).toUpperCase()
}

function UserMenu({ email }: { email: string }) {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none" aria-label="Account menu">
        <Avatar>
          <AvatarFallback>{initialsFromEmail(email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel className="truncate text-sm font-normal tracking-normal text-foreground normal-case">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { UserMenu }
```

The sign-out behavior (`supabase.auth.signOut()` → `router.push("/login")` → `router.refresh()`) is copied verbatim from the current `web/components/app-nav.tsx`, which this replaces (deleted in Task 5).

- [ ] **Step 3: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/app-shell/theme-toggle.tsx web/components/app-shell/user-menu.tsx
git commit -m "feat: add theme toggle and user menu header controls"
```

---

### Task 3: Sidebar (Desktop + Mobile Drawer)

**Files:**
- Create: `web/components/app-shell/sidebar.tsx`

**Interfaces:**
- Consumes: `Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger` from Task 1; `Button` from `@/components/ui/button`; `usePathname` from `next/navigation`; `cn` from `@/lib/utils`.
- Produces (consumed by Task 4):
  - `Sidebar` (no props) — desktop-only persistent `<aside>`, hidden below the `md` breakpoint.
  - `MobileSidebar` (no props) — a hamburger `Button` that opens a `Sheet` containing the same nav links, visible only below `md`.

- [ ] **Step 1: Write the sidebar**

`web/components/app-shell/sidebar.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  InboxIcon,
  LayoutDashboardIcon,
  MenuIcon,
  SettingsIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 border border-transparent px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-border bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 md:flex">
      <Link href="/dashboard" className="text-lg font-bold tracking-tight">
        Glint<span className="text-primary">.</span>
      </Link>
      <SidebarNav />
    </aside>
  )
}

function MobileSidebar() {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation"
        >
          <MenuIcon className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-64 gap-6 p-4">
        <SheetHeader className="p-0">
          <SheetTitle className="text-lg font-bold tracking-tight normal-case">
            Glint<span className="text-primary">.</span>
          </SheetTitle>
        </SheetHeader>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

export { Sidebar, MobileSidebar }
```

- [ ] **Step 2: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add web/components/app-shell/sidebar.tsx
git commit -m "feat: add desktop sidebar and mobile drawer navigation"
```

---

### Task 4: Header, PageHeader, and AppShell Composition

**Files:**
- Create: `web/components/app-shell/header.tsx`
- Create: `web/components/app-shell/page-header.tsx`
- Create: `web/components/app-shell/app-shell.tsx`

**Interfaces:**
- Consumes: `MobileSidebar, Sidebar` from Task 3; `ThemeToggle, UserMenu` from Task 2.
- Produces (consumed by Task 5 (`AppShell`), Tasks 6/7/8 (`PageHeader`)):
  - `Header({ email }: { email: string })` from `@/components/app-shell/header` — sticky top bar with the mobile nav trigger on the left and theme toggle + user menu on the right. Contains no page-specific content.
  - `PageHeader({ title, children }: { title: string; children?: React.ReactNode })` from `@/components/app-shell/page-header` — a per-page title row with optional right-aligned controls (e.g. Inbox's search/sort). Rendered by each page itself, directly below the sticky `Header`, not by the shell.
  - `AppShell({ email, children }: { email: string; children: React.ReactNode })` from `@/components/app-shell/app-shell` — composes `Sidebar` + `Header` + `<main>{children}</main>`.

- [ ] **Step 1: Write the header**

`web/components/app-shell/header.tsx`:

```tsx
import { MobileSidebar } from "./sidebar"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

function Header({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center border-b border-border bg-background/80 p-4 backdrop-blur">
      <MobileSidebar />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu email={email} />
      </div>
    </header>
  )
}

export { Header }
```

Note the `ml-auto` on the controls wrapper rather than `justify-between` on the header itself: `MobileSidebar`'s trigger button is `md:hidden`, so on desktop it's removed from layout flow entirely. `justify-between` with only one in-flow child would push that child to the *start*, not the end — `ml-auto` is unaffected by whether the sibling is present.

- [ ] **Step 2: Write the page header**

`web/components/app-shell/page-header.tsx`:

```tsx
import { type ReactNode } from "react"

function PageHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export { PageHeader }
```

- [ ] **Step 3: Write the AppShell**

`web/components/app-shell/app-shell.tsx`:

```tsx
import { type ReactNode } from "react"

import { Header } from "./header"
import { Sidebar } from "./sidebar"

function AppShell({
  email,
  children,
}: {
  email: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header email={email} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}

export { AppShell }
```

- [ ] **Step 4: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add web/components/app-shell/header.tsx web/components/app-shell/page-header.tsx web/components/app-shell/app-shell.tsx
git commit -m "feat: add Header, PageHeader, and AppShell composition"
```

---

### Task 5: Route Group Migration — Wire Up AppShell

**Files:**
- Create: `web/app/(app)/layout.tsx`
- Move (`git mv`): `web/app/inbox/page.tsx` → `web/app/(app)/inbox/page.tsx`
- Move (`git mv`): `web/app/inbox/lead-inbox.tsx` → `web/app/(app)/inbox/lead-inbox.tsx`
- Move (`git mv`): `web/app/settings/page.tsx` → `web/app/(app)/settings/page.tsx`
- Move (`git mv`): `web/app/settings/pairing-panel.tsx` → `web/app/(app)/settings/pairing-panel.tsx`
- Modify: `web/app/(app)/inbox/page.tsx` (remove `<AppNav />`)
- Modify: `web/app/(app)/settings/page.tsx` (remove `<AppNav />`)
- Modify: `web/app/page.tsx` (redirect target)
- Delete: `web/components/app-nav.tsx`

**Interfaces:**
- Consumes: `AppShell` from Task 4; `createClient` from `@/lib/supabase/server` (existing).
- Produces: `/inbox` and `/settings` render inside `AppShell` (URLs unchanged — route groups don't affect URLs); `/dashboard` route now exists as a target (page created in Task 6) and `/` redirects authenticated+onboarded users there instead of `/inbox`.

- [ ] **Step 1: Create the route group directories and move the existing pages into them**

```bash
mkdir -p "web/app/(app)/inbox" "web/app/(app)/settings"
git mv web/app/inbox/page.tsx "web/app/(app)/inbox/page.tsx"
git mv web/app/inbox/lead-inbox.tsx "web/app/(app)/inbox/lead-inbox.tsx"
git mv web/app/settings/page.tsx "web/app/(app)/settings/page.tsx"
git mv web/app/settings/pairing-panel.tsx "web/app/(app)/settings/pairing-panel.tsx"
rmdir web/app/inbox web/app/settings
```

Expected: `web/app/inbox/` and `web/app/settings/` no longer exist; their contents now live under `web/app/(app)/`.

- [ ] **Step 2: Write the shared `(app)` layout**

`web/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AppShell } from "@/components/app-shell/app-shell"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  return <AppShell email={user.email ?? ""}>{children}</AppShell>
}
```

- [ ] **Step 3: Remove `<AppNav />` from the moved Inbox page**

In `web/app/(app)/inbox/page.tsx`, remove the `AppNav` import and its usage so the file reads:

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

  return <LeadInbox initialLeads={(leads ?? []) as Lead[]} userId={user.id} />
}
```

- [ ] **Step 4: Remove `<AppNav />` from the moved Settings page**

In `web/app/(app)/settings/page.tsx`, remove the `AppNav` import and its usage so the file reads:

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

- [ ] **Step 5: Update the root redirect target**

In `web/app/page.tsx`, change the final line from `redirect("/inbox")` to `redirect("/dashboard")`. The full file after the change:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Landing } from "@/components/landing"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <Landing />
  }

  const { data: icp } = await supabase
    .from("icps")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!icp) {
    redirect("/onboarding")
  }

  redirect("/dashboard")
}
```

- [ ] **Step 6: Delete the now-unused AppNav component**

```bash
git rm web/components/app-nav.tsx
```

- [ ] **Step 7: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: `pnpm typecheck` passes with zero errors. `pnpm lint` should report exactly the one pre-existing `react-hooks/set-state-in-effect` error in `web/app/(app)/settings/pairing-panel.tsx` (its new path after the move) and no other errors — see Global Constraints. If `pnpm typecheck` fails because `/dashboard` doesn't exist yet, that's expected until Task 6; this task doesn't reference `/dashboard` from any component that gets type-checked against the filesystem, so it should not actually fail — Next's route existence isn't a TypeScript concern.

- [ ] **Step 8: Manual verification**

Run (cwd `web/`): `pnpm dev`, then:
- Visit `http://localhost:3000/inbox` signed in — confirm the sidebar (desktop) renders with "Inbox" highlighted as active, the header shows the theme toggle and a user avatar, and the lead list still renders (unstyled beyond the previous look is fine — restyling is Task 7).
- Visit `http://localhost:3000/settings` signed in — confirm the same shell renders with "Settings" highlighted, and the pairing panel still works (generate/revoke).
- Click the user avatar → confirm the dropdown shows your email and "Sign out" works (redirects to `/login`).
- Shrink the browser below the `md` breakpoint (or use dev tools device mode) → confirm the sidebar disappears and a hamburger button appears in the header; clicking it opens the drawer with the same nav links, and clicking a link navigates and closes the drawer.
- Visit `http://localhost:3000/inbox` while signed out → confirm redirect to `/login` (the shared layout's auth check).

- [ ] **Step 9: Commit**

```bash
git add -A web/app web/components/app-nav.tsx
git commit -m "refactor: move Inbox/Settings into a shared (app) route group with AppShell"
```

---

### Task 6: Dashboard Page

**Files:**
- Create: `web/app/(app)/dashboard/page.tsx`
- Create: `web/app/(app)/dashboard/dashboard-view.tsx`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `Card, CardHeader, CardTitle, CardContent, CardFooter` from `@/components/ui/card`; `Badge` from `@/components/ui/badge`; `PageHeader` from `@/components/app-shell/page-header`.
- Produces: the `/dashboard` route. `DashboardData` type and `DashboardView` component are exported from `dashboard-view.tsx` but consumed only by `dashboard/page.tsx` — no other task imports them.

- [ ] **Step 1: Write the dashboard view component**

`web/app/(app)/dashboard/dashboard-view.tsx`:

```tsx
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

export type DashboardData = {
  totalLeads: number
  newLeads: number
  contactedLeads: number
  avgScore: number | null
  icp: {
    target_roles: string[] | null
    company_types: string[] | null
    pain_points: string[] | null
  } | null
  recentLeads: {
    id: string
    name: string | null
    company: string | null
    role: string | null
    linkedin_url: string | null
    match_score: number | null
  }[]
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-semibold">{value}</CardContent>
    </Card>
  )
}

function IcpPillGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="normal-case">
            {v}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function IcpCard({ icp }: { icp: NonNullable<DashboardData["icp"]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your ICP</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <IcpPillGroup label="Target roles" values={icp.target_roles ?? []} />
        <IcpPillGroup label="Company types" values={icp.company_types ?? []} />
        <IcpPillGroup label="Pain points" values={icp.pain_points ?? []} />
      </CardContent>
    </Card>
  )
}

export function DashboardView({ data }: { data: DashboardData }) {
  if (data.totalLeads === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="flex flex-col gap-6 p-4">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No leads yet. Connect the extension to start scoring leads.
              </p>
              <Link
                href="/settings"
                className="text-sm font-medium underline underline-offset-4"
              >
                Go to Settings
              </Link>
            </CardContent>
          </Card>
          {data.icp && <IcpCard icp={data.icp} />}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-6 p-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total leads" value={String(data.totalLeads)} />
          <StatCard label="New" value={String(data.newLeads)} />
          <StatCard label="Contacted" value={String(data.contactedLeads)} />
          <StatCard
            label="Avg match score"
            value={data.avgScore !== null ? String(data.avgScore) : "—"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {data.icp && <IcpCard icp={data.icp} />}

          <Card>
            <CardHeader>
              <CardTitle>Recent leads</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.recentLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads yet.</p>
              ) : (
                data.recentLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {lead.name ?? "Unknown"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[lead.role, lead.company].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline">{lead.match_score ?? "—"}</Badge>
                  </div>
                ))
              )}
            </CardContent>
            <CardFooter>
              <Link
                href="/inbox"
                className="text-sm font-medium underline underline-offset-4"
              >
                View all →
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Write the dashboard page (server component)**

`web/app/(app)/dashboard/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardView, type DashboardData } from "./dashboard-view"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [
    { count: total },
    { count: newCount },
    { count: contactedCount },
    { data: scores },
    { data: icp },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "new"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "contacted"),
    supabase.from("leads").select("match_score").eq("user_id", user.id),
    supabase
      .from("icps")
      .select("target_roles, company_types, pain_points")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("id, name, company, role, linkedin_url, match_score")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const scoreValues = (scores ?? [])
    .map((l) => l.match_score)
    .filter((s): s is number => typeof s === "number")
  const avgScore =
    scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : null

  const data: DashboardData = {
    totalLeads: total ?? 0,
    newLeads: newCount ?? 0,
    contactedLeads: contactedCount ?? 0,
    avgScore,
    icp: icp ?? null,
    recentLeads: recent ?? [],
  }

  return <DashboardView data={data} />
}
```

Each Supabase call above returns `{ data: null, error }` (or `{ count: null, error }`) on failure rather than throwing — the `?? 0` / `?? null` / `?? []` fallbacks already handle every error case by degrading to an empty/zeroed dashboard, matching the "no dashboard crash on read failure" requirement from the spec without any extra try/catch.

- [ ] **Step 3: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: zero new errors (the one pre-existing `pairing-panel.tsx` error from Task 5 is still expected).

- [ ] **Step 4: Manual verification**

Run (cwd `web/`): `pnpm dev`, sign in as a user with no leads yet, visit `http://localhost:3000/dashboard`.
Expected: the empty state renders ("No leads yet. Connect the extension...", link to Settings) and the "Your ICP" card renders below it (since onboarding always creates an `icps` row).

If leads exist for that user (e.g. seeded per `docs/superpowers/plans/2026-07-06-day2-leads-scoring-inbox.md` Task 4's seed data), reload and confirm: four stat tiles show correct counts/average, the "Your ICP" card shows pills, and "Recent leads" lists up to 5 leads with a working "View all →" link to `/inbox`.

- [ ] **Step 5: Commit**

```bash
git add "web/app/(app)/dashboard"
git commit -m "feat: add dashboard overview page with stats, ICP summary, and recent leads"
```

---

### Task 7: Inbox Restyle — Search, Sort, Card Rows

**Files:**
- Modify: `web/app/(app)/inbox/lead-inbox.tsx`

**Interfaces:**
- Consumes: `Card, CardContent` from `@/components/ui/card`; `PageHeader` from `@/components/app-shell/page-header`; `Input` from `@/components/ui/input` (existing); `cn` from `@/lib/utils`; existing `Badge`, `Button`, `Select*` imports.
- Produces: `LeadInbox({ initialLeads, userId }: { initialLeads: Lead[]; userId: string })` and `Lead` type — **signature unchanged** from before this task, so `web/app/(app)/inbox/page.tsx` (already wired in Task 5) needs no changes.

- [ ] **Step 1: Replace the file with the restyled version**

Realtime subscription (`useEffect` + `postgres_changes` INSERT listener) and `updateStatus`'s optimistic-update-with-rollback are copied unchanged from the current file. Replace `web/app/(app)/inbox/lead-inbox.tsx` with:

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/app-shell/page-header"

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

type ScoreBucket = "high" | "medium" | "low"
type ScoreFilter = "all" | ScoreBucket
type SortKey = "score_desc" | "score_asc" | "newest" | "oldest"

const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "≥ 80" },
  { key: "medium", label: "50–79" },
  { key: "low", label: "< 50" },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "score_desc", label: "Score: high to low" },
  { key: "score_asc", label: "Score: low to high" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
]

const STATUSES: Lead["status"][] = ["new", "contacted", "ignored"]

const SCORE_ACCENT: Record<ScoreBucket, string> = {
  high: "border-l-primary",
  medium: "border-l-chart-2",
  low: "border-l-border",
}

function scoreBucket(score: number | null): ScoreBucket {
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

function matchesQuery(lead: Lead, query: string): boolean {
  if (!query) return true
  const haystack = [lead.name, lead.company, lead.role]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function sortLeads(leads: Lead[], sort: SortKey): Lead[] {
  const sorted = [...leads]
  switch (sort) {
    case "score_desc":
      return sorted.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1))
    case "score_asc":
      return sorted.sort((a, b) => (a.match_score ?? -1) - (b.match_score ?? -1))
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
  }
}

export function LeadInbox({
  initialLeads,
  userId,
}: {
  initialLeads: Lead[]
  userId: string
}) {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [filter, setFilter] = useState<ScoreFilter>("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("score_desc")

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

  const visible = useMemo(() => {
    const filtered = leads.filter(
      (l) =>
        (filter === "all" || scoreBucket(l.match_score) === filter) &&
        matchesQuery(l, query)
    )
    return sortLeads(filtered, sort)
  }, [leads, filter, query, sort])

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
    <>
      <PageHeader title="Lead inbox">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, role..."
          className="w-56"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-44" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex w-fit border border-border">
          {SCORE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {leads.length === 0
              ? "No leads yet. Start browsing LinkedIn with the extension to see matches here."
              : "No leads match your search/filters."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((lead) => {
              const bucket = scoreBucket(lead.match_score)
              return (
                <li key={lead.id}>
                  <Card className={cn("gap-2 border-l-4 py-4", SCORE_ACCENT[bucket])}>
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {lead.name ?? "Unknown"}
                          </p>
                          <p className="truncate text-sm text-muted-foreground">
                            {[lead.role, lead.company].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Badge variant={scoreVariant(lead.match_score)}>
                          {lead.match_score ?? "—"}
                        </Badge>
                      </div>

                      {lead.match_reasons && lead.match_reasons.length > 0 && (
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
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
                          onValueChange={(v) =>
                            updateStatus(lead.id, v as Lead["status"])
                          }
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
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: zero new errors (the one pre-existing `pairing-panel.tsx` error is still expected).

- [ ] **Step 3: Manual verification**

Run (cwd `web/`): `pnpm dev`, sign in as a user with a few seeded leads (see Task 6, Step 4), visit `http://localhost:3000/inbox`.
Expected:
- Search box filters the list by name/company/role as you type.
- Sort dropdown reorders the list (try "Score: low to high" and "Newest first").
- Score filter segmented control still narrows by bucket, combined correctly with search (e.g. search + "≥ 80" together).
- Each lead renders as a card with a colored left border matching its score bucket.
- Status dropdown still persists changes (reload → status remains, since the write still goes through RLS, unchanged from before).
- The realtime insert behavior still works: with two browser tabs open to `/inbox` as the same user, inserting a lead via the DB (or `score-lead` function) in one should make it appear live in the other without a refresh.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/inbox/lead-inbox.tsx"
git commit -m "feat: restyle Inbox with search, sort, and card-based lead rows"
```

---

### Task 8: Settings Restyle

**Files:**
- Modify: `web/app/(app)/settings/pairing-panel.tsx`

**Interfaces:**
- Consumes: `Card, CardHeader, CardTitle, CardDescription, CardContent` from `@/components/ui/card`; `PageHeader` from `@/components/app-shell/page-header`.
- Produces: `PairingPanel()` (no props) — **signature unchanged**, so `web/app/(app)/settings/page.tsx` needs no changes.

- [ ] **Step 1: Replace the file with the restyled version**

All logic (`generate`, `revoke`, `loadPairings`, and the pre-existing `useEffect` calling `loadPairings()`) is copied unchanged. Replace `web/app/(app)/settings/pairing-panel.tsx` with:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

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
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Connect extension</CardTitle>
            <CardDescription>
              Generate a code, then paste it into the Glint extension popup.
              Codes expire in 10 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={generate} disabled={loading} className="self-start">
              {loading ? "Generating..." : "Generate pairing code"}
            </Button>
            {code && (
              <p className="border border-border p-3 text-center font-mono text-2xl tracking-widest">
                {code}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Paired devices</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pairings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pairings yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pairings.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border border-border p-3 text-sm"
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
          </CardContent>
        </Card>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify**

Run (cwd `web/`): `pnpm typecheck && pnpm lint`
Expected: `pnpm typecheck` passes with zero errors. `pnpm lint` reports exactly the one pre-existing `react-hooks/set-state-in-effect` error on the `loadPairings()` call in this same file's `useEffect` (see Global Constraints) and no other errors.

- [ ] **Step 3: Manual verification**

Run (cwd `web/`): `pnpm dev`, visit `http://localhost:3000/settings` signed in.
Expected: "Connect extension" and "Paired devices" render as separate cards; "Generate pairing code" still produces a code and it still appears under "Paired devices"; "Revoke" still removes a pairing.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/settings/pairing-panel.tsx"
git commit -m "feat: restyle Settings with card-based layout"
```

---

### Task 9: Final Verification (Full Build + Click-Through)

**Files:** none — verification only.

**Interfaces:**
- Consumes: everything from Tasks 1–8.

- [ ] **Step 1: Full production build**

Run (cwd `web/`): `pnpm run build`
Expected: `Compiled successfully`, no type errors. (This is stricter than `pnpm typecheck` alone — it also catches any Server/Client Component boundary mistakes.)

- [ ] **Step 2: Full click-through**

Run (cwd `web/`): `pnpm dev`, signed in as a user with an ICP and a few seeded leads:
- `/dashboard` — stat tiles, ICP card, recent leads, "View all →" link to `/inbox` all render correctly.
- `/inbox` — search, sort, score filter, card rows, status updates, and realtime insert all work (per Task 7, Step 3).
- `/settings` — pairing generate/revoke works (per Task 8, Step 3).
- Sidebar — desktop persistent sidebar highlights the active route correctly across all three pages; mobile drawer opens/closes and navigates correctly.
- Header — theme toggle switches light/dark and stays in sync with the existing `d` keyboard shortcut (`web/components/theme-provider.tsx`'s `ThemeHotkey`, unchanged); user menu shows the correct email and signs out correctly.
- Visit `/` while signed in with an existing ICP → confirm it redirects to `/dashboard` (not `/inbox`).
- Visit `/inbox`, `/settings`, or `/dashboard` while signed out → confirm redirect to `/login` in all three cases.

- [ ] **Step 3: Confirm final lint state**

Run (cwd `web/`): `pnpm lint`
Expected: exactly the one pre-existing `react-hooks/set-state-in-effect` error in `web/app/(app)/settings/pairing-panel.tsx` and no other errors anywhere in the repo.

No commit — verification only.

---
