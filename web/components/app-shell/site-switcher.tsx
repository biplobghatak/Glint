"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Site } from "@/lib/sites"
import { switchSite } from "@/lib/site-actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function SiteSwitcher({
  sites,
  activeSiteId,
}: {
  sites: Site[]
  activeSiteId: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const active = sites.find((s) => s.id === activeSiteId) ?? null

  // One site is not a choice. Show it as a label rather than a control that
  // does nothing when clicked.
  if (sites.length <= 1) {
    return (
      <p className="text-muted-foreground truncate px-3 text-xs font-medium tracking-wider uppercase">
        {active?.name ?? "No site"}
      </p>
    )
  }

  function choose(siteId: string) {
    setOpen(false)
    if (siteId === activeSiteId) return
    startTransition(async () => {
      await switchSite(siteId)
      router.refresh()
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label="Switch site"
          className="w-full justify-between gap-2 normal-case"
        >
          <span className="truncate">{active?.name ?? "Select a site"}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {sites.map((site) => (
          <DropdownMenuItem
            key={site.id}
            onSelect={() => choose(site.id)}
            className="justify-between gap-2"
          >
            <span className="truncate">{site.name}</span>
            <CheckIcon
              className={cn(
                "size-3.5 shrink-0",
                site.id === activeSiteId ? "opacity-100" : "opacity-0"
              )}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/onboarding")}>
          <PlusIcon className="size-3.5" />
          Add a website
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { SiteSwitcher }
