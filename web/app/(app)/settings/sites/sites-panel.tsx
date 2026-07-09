"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import type { Site } from "@/lib/sites"
import { deleteSite } from "@/lib/site-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SiteRow = Site & {
  leadCount: number
  folderCount: number
}

function DeleteSiteDialog({ site }: { site: SiteRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Typing the name is the only guard. Deleting a site takes its leads with it
  // and there is no undo.
  const confirmed = typed.trim() === site.name

  function handleDelete() {
    if (!confirmed) return
    setError(null)
    startTransition(async () => {
      const { error: deleteError } = await deleteSite(site.id)
      if (deleteError) {
        setError(deleteError)
        return
      }
      setOpen(false)
      setTyped("")
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setTyped("")
        setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {site.name}</DialogTitle>
          <DialogDescription>
            This permanently deletes {site.leadCount.toLocaleString()}{" "}
            {site.leadCount === 1 ? "lead" : "leads"} and {site.folderCount}{" "}
            {site.folderCount === 1 ? "folder" : "folders"}, and revokes every
            extension key paired to it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`confirm-${site.id}`}>
            Type <span className="font-semibold">{site.name}</span> to confirm
          </Label>
          <Input
            id={`confirm-${site.id}`}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!confirmed || pending}
            onClick={handleDelete}
          >
            {pending ? "Deleting..." : "Delete site"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SitesPanel({
  sites,
  activeSiteId,
}: {
  sites: SiteRow[]
  activeSiteId: string | null
}) {
  const onlySite = sites.length === 1

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Websites</CardTitle>
          <CardDescription>
            Each website has its own ideal customer profile, its own leads, and
            its own extension key.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {sites.map((site) => (
              <li
                key={site.id}
                className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{site.name}</span>
                    {site.id === activeSiteId && <Badge>Active</Badge>}
                  </div>
                  <span className="text-muted-foreground truncate text-sm">
                    {site.leadCount.toLocaleString()}{" "}
                    {site.leadCount === 1 ? "lead" : "leads"} ·{" "}
                    {site.website_url || "No URL yet"}
                  </span>
                </div>

                {/* Deleting your only site would strand you with no ICP and no
                    inbox. Onboarding is the way back in, so removing the last
                    site is simply not offered. */}
                {onlySite ? (
                  <span className="text-muted-foreground text-sm">
                    Your only website
                  </span>
                ) : (
                  <DeleteSiteDialog site={site} />
                )}
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" className="self-start">
            <Link href="/onboarding">
              <PlusIcon className="size-3.5" />
              Add a website
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export { SitesPanel }
export type { SiteRow }
