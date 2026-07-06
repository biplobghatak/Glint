"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function AppNav() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  function navLink(href: string, label: string) {
    const active = pathname === href
    return (
      <Link
        href={href}
        className={
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }
      >
        {label}
      </Link>
    )
  }

  return (
    <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between p-4 text-sm">
        <div className="flex items-center gap-5">
          <Link href="/inbox" className="font-heading font-bold">
            Glint
          </Link>
          {navLink("/inbox", "Inbox")}
          {navLink("/settings", "Settings")}
        </div>
        <Button size="sm" variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  )
}
