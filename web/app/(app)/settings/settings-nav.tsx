"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const TABS = [
  { href: "/settings/icp", label: "ICP" },
  { href: "/settings/keys", label: "Keys" },
  { href: "/settings/billing", label: "Billing" },
]

function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav className="border-border bg-muted/40 flex w-fit gap-1 rounded-md border p-1">
      {TABS.map(({ href, label }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export { SettingsNav }
