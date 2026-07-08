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
                        <p className="text-sm italic">&quot;{lead.post_context}&quot;</p>
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
