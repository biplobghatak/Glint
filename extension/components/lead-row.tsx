import { useState } from "react"
import type { LeadRow as Lead } from "@/lib/leads"
import type { FolderRow } from "@/lib/folders"
import { countryLabel } from "@/lib/filter"
import { formatScore } from "@/lib/format"
import { contactState } from "@/lib/contact-state"
import { putDraft, profilePathOf } from "@/lib/draft"
import {
  fetchDraft,
  RateLimitedError,
  DraftUnavailableError,
} from "@/lib/suggestions"

// A lead's folder_id is genuinely null when unfiled, and <option value=""> is
// what the DOM reports for "no value". The sentinel keeps the two apart.
const UNFILED = "__unfiled"

// Must equal MAX_OPENER_CHARS in supabase/functions/draft-opener/validate.ts,
// which is where the limit is actually ENFORCED — the server rejects an opener
// over it and never returns one. This copy exists only to draw the counter, and
// cannot import that module (Deno source, not bundled into the extension). If
// the real LinkedIn connection-note limit turns out not to be 200, both must
// change together, or the counter will quietly disagree with the server.
const DRAFT_MAX_LEN = 200

type DraftState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; opener: string; isFallback: boolean }
  | { status: "error"; message: string }

// Same thresholds the injected LinkedIn badge uses, expressed against the
// theme's tokens rather than the badge's hardcoded hexes.
function scoreClass(score: number, minScore: number): string {
  if (score < minScore) return "bg-muted text-muted-foreground"
  if (score >= 80) return "bg-primary text-primary-foreground"
  return "bg-accent text-accent-foreground"
}

function subtitle(lead: Lead): string | null {
  if (lead.role && lead.company) return `${lead.role} @ ${lead.company}`
  return lead.role ?? lead.company ?? null
}

function place(lead: Lead): string | null {
  if (lead.location) return lead.location
  return lead.country ? countryLabel(lead.country) : null
}

// "Jane Doe" -> "JD". Falls back to "?" for an unnamed lead rather than
// rendering an empty circle.
function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase()
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard permission denied or unavailable. Nothing useful to fall
          // back to short of the user selecting the text themselves.
        }
      }}
      className="border-border bg-background hover:bg-accent shrink-0 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] transition-colors"
    >
      {copied ? "Copied" : `Copy ${label}`}
    </button>
  )
}

export function LeadRow({
  lead,
  minScore,
  folders,
  onAssignFolder,
}: {
  lead: Lead
  minScore: number
  folders: FolderRow[]
  onAssignFolder: (leadId: string, folderId: string | null) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<DraftState>({ status: "idle" })

  const score = lead.match_score
  const belowThreshold = score !== null && score < minScore
  const sub = subtitle(lead)
  const where = place(lead)
  const reasons = lead.match_reasons ?? []
  const state = contactState(lead)
  // linkedin_url can be null (an unenriched or malformed lead); the profile
  // path derived from it is what both "Open profile" and the draft handoff
  // need, so gate both on it existing rather than failing separately.
  const profilePath = lead.linkedin_url ? profilePathOf(lead.linkedin_url) : null
  const canOpenProfile = lead.linkedin_url !== null && profilePath !== null

  async function handleDraftMessage() {
    setDraft({ status: "loading" })
    try {
      const opener = await fetchDraft(lead.id)
      setDraft({ status: "ready", opener, isFallback: false })
    } catch (err: unknown) {
      if (err instanceof RateLimitedError) {
        setDraft({ status: "error", message: "Too many drafts, wait a moment." })
        return
      }
      if (err instanceof DraftUnavailableError) {
        // The model failed, but the reasons this lead scored well are already
        // stored. The user still gets something to work from, and the card
        // says plainly that it isn't a written opener.
        const fallback = reasons.join("\n\n")
        if (!fallback) {
          setDraft({ status: "error", message: "Couldn't draft a message for this lead." })
          return
        }
        setDraft({ status: "ready", opener: fallback, isFallback: true })
        return
      }
      setDraft({ status: "error", message: "Couldn't draft a message for this lead." })
    }
  }

  // Glint stops here: it writes the draft and opens the profile tab. The
  // content script fills LinkedIn's own note box, and the human presses
  // LinkedIn's own Send. Nothing here submits anything.
  async function handleSend() {
    if (draft.status !== "ready" || !profilePath || !lead.linkedin_url) return
    await putDraft({
      profilePath,
      opener: draft.opener,
      leadName: lead.name ?? "this lead",
      createdAt: Date.now(),
      isFallback: draft.isFallback,
    })
    chrome.tabs.create({ url: lead.linkedin_url })
    setDraft({ status: "idle" })
  }

  function handleOpenProfile() {
    if (lead.linkedin_url) chrome.tabs.create({ url: lead.linkedin_url })
  }

  return (
    <li
      className={
        "border-border bg-card flex flex-col gap-2 rounded-[var(--radius)] border p-3 " +
        (belowThreshold ? "opacity-60" : "")
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 text-left"
      >
        {lead.avatar_url ? (
          // A null/empty src renders Chrome's broken-image icon, so the
          // <img> only ever appears once there is a real URL to point it at.
          <img
            src={lead.avatar_url}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
          >
            {initials(lead.name)}
          </span>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {lead.name ?? "Unnamed lead"}
          </span>
          {sub && <span className="text-muted-foreground truncate text-xs">{sub}</span>}
          <span className="text-muted-foreground truncate text-xs">
            {where ?? "Unknown location"}
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {score !== null && (
            <span
              className={
                "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " +
                scoreClass(score, minScore)
              }
              title={
                belowThreshold ? `Below your threshold of ${formatScore(minScore)}` : undefined
              }
            >
              {formatScore(score)}
            </span>
          )}
          {/* The whole point of the collapsed state: scan a long list for the
              thing you care about without expanding anything. */}
          <span className="text-muted-foreground flex gap-1 text-xs" aria-hidden="true">
            {lead.email && <span title="Has email">✉</span>}
            {lead.phone && <span title="Has phone">☎</span>}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-border flex flex-col gap-2 border-t pt-2">
          {reasons.length > 0 && (
            <ul className="text-muted-foreground list-disc pl-4 text-xs">
              {reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-1.5">
            {state === "not_looked_up" && (
              <p className="text-muted-foreground text-xs">Not looked up yet</p>
            )}
            {state === "no_public_info" && (
              <p className="text-muted-foreground text-xs">No public contact info</p>
            )}
            {state === "has_info" && (
              <>
                {lead.email && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs">{lead.email}</span>
                    <CopyButton value={lead.email} label="email" />
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs">{lead.phone}</span>
                    <CopyButton value={lead.phone} label="phone" />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleOpenProfile}
              disabled={!canOpenProfile}
              className="border-border bg-background hover:bg-accent flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs transition-colors disabled:opacity-50"
            >
              Open profile
            </button>
            <button
              type="button"
              onClick={handleDraftMessage}
              disabled={!canOpenProfile || draft.status === "loading"}
              className="bg-primary text-primary-foreground flex-1 rounded-[var(--radius)] px-2 py-1 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {draft.status === "loading" ? "Drafting…" : "Draft message"}
            </button>
          </div>

          {draft.status === "error" && (
            <p className="text-destructive text-xs">{draft.message}</p>
          )}

          {draft.status === "ready" && (
            <div className="border-border flex flex-col gap-1.5 rounded-[var(--radius)] border p-2">
              {draft.isFallback && (
                <p className="text-muted-foreground text-[11px]">
                  Couldn't write a message — here's why this lead matched instead.
                </p>
              )}
              <p className="text-xs whitespace-pre-wrap">{draft.opener}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  {draft.opener.length}/{DRAFT_MAX_LEN}
                </span>
                <button
                  type="button"
                  onClick={handleSend}
                  className="bg-primary text-primary-foreground rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label htmlFor={`folder-${lead.id}`} className="sr-only">
              Folder for {lead.name ?? "this lead"}
            </label>
            <select
              id={`folder-${lead.id}`}
              value={lead.folder_id ?? UNFILED}
              onChange={(e) =>
                onAssignFolder(
                  lead.id,
                  e.target.value === UNFILED ? null : e.target.value
                )
              }
              className="border-border bg-card text-muted-foreground focus-visible:ring-ring min-w-0 flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs outline-none focus-visible:ring-2"
            >
              <option value={UNFILED}>Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </li>
  )
}
