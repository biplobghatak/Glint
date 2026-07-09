import type { LeadRow as Lead } from "@/lib/leads"
import { countryLabel } from "@/lib/filter"

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

export function LeadRow({ lead, minScore }: { lead: Lead; minScore: number }) {
  const score = lead.match_score
  const belowThreshold = score !== null && score < minScore
  const sub = subtitle(lead)
  const where = place(lead)
  // match_reasons is the highest-value thing stored about a lead, and until now
  // it only ever appeared in a title tooltip on the injected badge.
  const topReason = lead.match_reasons?.[0] ?? null

  return (
    <li
      className={
        "border-border bg-card flex flex-col gap-1 rounded-[var(--radius)] border p-3 " +
        (belowThreshold ? "opacity-60" : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {lead.name ?? "Unnamed lead"}
          </span>
          {sub && (
            <span className="text-muted-foreground truncate text-xs">{sub}</span>
          )}
        </div>
        {score !== null && (
          <span
            className={
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums " +
              scoreClass(score, minScore)
            }
            title={belowThreshold ? `Below your threshold of ${minScore}` : undefined}
          >
            {score}
          </span>
        )}
      </div>

      {topReason && (
        <p className="text-muted-foreground line-clamp-2 text-xs">{topReason}</p>
      )}

      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span className="truncate">{where ?? "Unknown location"}</span>
        {lead.linkedin_url && (
          // A human clicking a link is not the autonomous loop opening a
          // profile page. The no-profile-pages rule governs the agent run.
          <a
            href={lead.linkedin_url}
            target="_blank"
            rel="noreferrer"
            className="text-primary shrink-0 hover:underline"
          >
            View
          </a>
        )}
      </div>
    </li>
  )
}
