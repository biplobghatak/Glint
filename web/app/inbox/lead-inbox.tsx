"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

type ScoreFilter = "all" | "high" | "medium" | "low"

const SCORE_FILTERS: { key: ScoreFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "≥ 80" },
  { key: "medium", label: "50–79" },
  { key: "low", label: "< 50" },
]

const STATUSES: Lead["status"][] = ["new", "contacted", "ignored"]

function scoreBucket(score: number | null): ScoreFilter {
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

  const visible = useMemo(
    () =>
      filter === "all"
        ? leads
        : leads.filter((l) => scoreBucket(l.match_score) === filter),
    [leads, filter]
  )

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
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Lead inbox</h1>
        <div className="flex gap-1">
          {SCORE_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No leads yet. Start browsing LinkedIn with the extension to see matches
          here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((lead) => (
            <li
              key={lead.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{lead.name ?? "Unknown"}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {[lead.role, lead.company].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge variant={scoreVariant(lead.match_score)}>
                  {lead.match_score ?? "—"}
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
                  onValueChange={(v) => updateStatus(lead.id, v as Lead["status"])}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
