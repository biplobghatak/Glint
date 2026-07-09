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
        // Settings redirects to /settings/icp, so an exact match would never
        // light up the nav item the user is actually looking at.
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors",
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
    <aside className="border-sidebar-border bg-sidebar hidden h-full w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r p-4 md:flex">
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
