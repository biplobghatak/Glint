"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FolderIcon } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { PageHeader } from "@/components/app-shell/page-header"
import { FolderRail, type Folder, type FolderId } from "@/components/inbox/folder-rail"
import { formatScoreOrDash } from "@/lib/format"

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
  folder_id: string | null
  created_at: string
}

type ScoreBucket = "high" | "medium" | "low"
type ScoreFilter = "all" | ScoreBucket
type SortKey = "score_desc" | "score_asc" | "newest" | "oldest"

// Labels are on the user's 0-10 scale; scoreBucket() below still compares against
// the 0-100 scale the score is stored on. Only the text changes.
const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "≥ 8.0" },
  { key: "medium", label: "5.0–7.9" },
  { key: "low", label: "< 5.0" },
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

// A Select value is always a string, so a lead's null folder_id needs a stand-in
// that isn't the empty string (which Radix treats as "no value").
const UNFILED = "__unfiled"

// Postgres reports a folders_user_name_idx violation as 23505. The index is on
// (user_id, lower(name)), so "Clients" and "clients" collide.
const UNIQUE_VIOLATION = "23505"

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

/**
 * Three states. `null` applies no filter; `""` means unfiled; a uuid means that
 * folder. Collapsing the first two would make "All leads" show only unfiled
 * leads, and nothing would look broken until a user noticed leads missing.
 */
function matchesFolder(lead: Lead, folderId: FolderId): boolean {
  if (folderId === null) return true
  if (folderId === "") return lead.folder_id === null
  return lead.folder_id === folderId
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
  initialFolders,
  userId,
}: {
  initialLeads: Lead[]
  initialFolders: Folder[]
  userId: string
}) {
  const supabase = createClient()
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [folders, setFolders] = useState<Folder[]>(initialFolders)
  const [folderId, setFolderId] = useState<FolderId>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)
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
      // Filing a lead from the side panel is an UPDATE, not an INSERT, and so is
      // the implicit unfile that `on delete set null` performs when a folder is
      // deleted. Without this handler neither ever reaches an open web tab, and
      // folders look broken while the Edge Function is working perfectly.
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const lead = payload.new as Lead
          // Replace in place. Prepending — the INSERT path — would duplicate the
          // lead at the top of the list.
          setLeads((cur) => cur.map((l) => (l.id === lead.id ? lead : l)))
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "leads",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // `leads` is `replica identity full`, so the old row carries user_id
          // and this subscription's filter matches. Under the default replica
          // identity only the primary key is sent and no DELETE would arrive.
          const lead = payload.old as Partial<Lead>
          if (!lead.id) return
          setLeads((cur) => cur.filter((l) => l.id !== lead.id))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, userId])

  // A folder created in the side panel must appear in this rail without a
  // refresh, and one deleted in another tab must disappear from it.
  useEffect(() => {
    const channel = supabase
      .channel("folders-rail")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "folders",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const folder = payload.new as Folder
          setFolders((cur) =>
            cur.some((f) => f.id === folder.id)
              ? cur
              : [...cur, folder].sort((a, b) => a.name.localeCompare(b.name))
          )
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "folders",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const folder = payload.new as Folder
          setFolders((cur) =>
            cur
              .map((f) => (f.id === folder.id ? folder : f))
              .sort((a, b) => a.name.localeCompare(b.name))
          )
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "folders",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const folder = payload.old as Partial<Folder>
          if (!folder.id) return
          setFolders((cur) => cur.filter((f) => f.id !== folder.id))
          // The affected leads also arrive as UPDATE events (on delete set
          // null), but unfiling them here too keeps the rail counts honest even
          // if those events are dropped.
          setLeads((cur) =>
            cur.map((l) => (l.folder_id === folder.id ? { ...l, folder_id: null } : l))
          )
          // The selected folder just ceased to exist; its id now matches nothing
          // and the list would read as "no leads match".
          setFolderId((cur) => (cur === folder.id ? null : cur))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, userId])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const lead of leads) {
      if (lead.folder_id) map[lead.folder_id] = (map[lead.folder_id] ?? 0) + 1
    }
    return map
  }, [leads])

  const unfiledCount = useMemo(
    () => leads.filter((l) => l.folder_id === null).length,
    [leads]
  )

  const visible = useMemo(() => {
    const filtered = leads.filter(
      (l) =>
        (filter === "all" || scoreBucket(l.match_score) === filter) &&
        matchesQuery(l, query) &&
        matchesFolder(l, folderId)
    )
    return sortLeads(filtered, sort)
  }, [leads, filter, query, sort, folderId])

  async function updateStatus(id: string, status: Lead["status"]) {
    const prev = leads
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, status } : l)))
    const { error } = await supabase
      .from("leads")
      .update({ status })
      .eq("id", id)
    if (error) setLeads(prev) // roll back on failure
  }

  // Same optimistic-with-rollback shape as updateStatus. A lead silently sitting
  // in the wrong folder is worse than an error.
  async function assignFolder(id: string, nextFolderId: string | null) {
    const prev = leads
    setLeads((cur) =>
      cur.map((l) => (l.id === id ? { ...l, folder_id: nextFolderId } : l))
    )
    const { error } = await supabase
      .from("leads")
      .update({ folder_id: nextFolderId })
      .eq("id", id)
    if (error) {
      setLeads(prev)
      setFolderError("Couldn't move that lead.")
    }
  }

  const createFolder = useCallback(
    async (name: string): Promise<boolean> => {
      setFolderError(null)
      const { data, error } = await supabase
        .from("folders")
        .insert({ user_id: userId, name })
        .select("id, name")
        .single()

      if (error) {
        setFolderError(
          error.code === UNIQUE_VIOLATION
            ? `A folder named “${name}” already exists.`
            : "Couldn't create that folder."
        )
        return false
      }
      // The realtime INSERT will also arrive; both paths dedupe by id.
      setFolders((cur) =>
        cur.some((f) => f.id === data.id)
          ? cur
          : [...cur, data as Folder].sort((a, b) => a.name.localeCompare(b.name))
      )
      return true
    },
    [supabase, userId]
  )

  const renameFolder = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      setFolderError(null)
      const prev = folders
      setFolders((cur) =>
        cur
          .map((f) => (f.id === id ? { ...f, name } : f))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
      const { error } = await supabase.from("folders").update({ name }).eq("id", id)
      if (error) {
        setFolders(prev)
        setFolderError(
          error.code === UNIQUE_VIOLATION
            ? `A folder named “${name}” already exists.`
            : "Couldn't rename that folder."
        )
        return false
      }
      return true
    },
    [supabase, folders]
  )

  const deleteFolder = useCallback(
    async (id: string) => {
      setFolderError(null)
      const prevFolders = folders
      const prevLeads = leads

      setFolders((cur) => cur.filter((f) => f.id !== id))
      // leads.folder_id is `on delete set null`: the leads survive, unfiled.
      setLeads((cur) =>
        cur.map((l) => (l.folder_id === id ? { ...l, folder_id: null } : l))
      )
      setFolderId((cur) => (cur === id ? null : cur))

      const { error } = await supabase.from("folders").delete().eq("id", id)
      if (error) {
        setFolders(prevFolders)
        setLeads(prevLeads)
        setFolderError("Couldn't delete that folder.")
      }
    },
    [supabase, folders, leads]
  )

  const rail = (
    <FolderRail
      folders={folders}
      selected={folderId}
      onSelect={(id) => {
        setFolderId(id)
        setRailOpen(false)
      }}
      counts={counts}
      allCount={leads.length}
      unfiledCount={unfiledCount}
      onCreate={createFolder}
      onRename={renameFolder}
      onDelete={deleteFolder}
      error={folderError}
      onDismissError={() => setFolderError(null)}
    />
  )

  const emptyMessage =
    leads.length === 0
      ? "No leads yet. Start browsing LinkedIn with the extension to see matches here."
      : folderId !== null && folderId !== "" && counts[folderId] === undefined
        ? "This folder is empty. Assign leads to it from the inbox or the extension."
        : "No leads match your search/filters."

  return (
    <>
      <PageHeader title="Lead inbox">
        <Sheet open={railOpen} onOpenChange={setRailOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open folders">
              <FolderIcon className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-72 gap-6 p-4">
            <SheetHeader className="p-0">
              <SheetTitle className="normal-case">Folders</SheetTitle>
            </SheetHeader>
            {rail}
          </SheetContent>
        </Sheet>
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

      <div className="flex flex-1 items-start">
        <aside className="border-sidebar-border bg-sidebar sticky top-0 hidden max-h-svh w-60 shrink-0 self-start overflow-y-auto border-r p-4 md:block">
          {rail}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="border-border bg-muted/40 flex w-fit gap-1 rounded-md border p-1">
            {SCORE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
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
            <p className="text-muted-foreground text-sm">{emptyMessage}</p>
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
                            <p className="text-muted-foreground truncate text-sm">
                              {[lead.role, lead.company].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <Badge variant={scoreVariant(lead.match_score)}>
                            {formatScoreOrDash(lead.match_score)}
                          </Badge>
                        </div>

                        {lead.match_reasons && lead.match_reasons.length > 0 && (
                          <ul className="text-muted-foreground list-disc pl-5 text-sm">
                            {lead.match_reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}

                        {lead.post_context && (
                          <p className="text-sm italic">&quot;{lead.post_context}&quot;</p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3">
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
                          <div className="flex items-center gap-2">
                            <Select
                              value={lead.folder_id ?? UNFILED}
                              onValueChange={(v) =>
                                assignFolder(lead.id, v === UNFILED ? null : v)
                              }
                            >
                              <SelectTrigger className="w-40" size="sm" aria-label="Folder">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNFILED}>Unfiled</SelectItem>
                                {folders.map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={lead.status}
                              onValueChange={(v) =>
                                updateStatus(lead.id, v as Lead["status"])
                              }
                            >
                              <SelectTrigger className="w-36" size="sm" aria-label="Status">
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
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
