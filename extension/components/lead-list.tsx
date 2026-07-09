import { LeadRow } from "@/components/lead-row"
import type { LeadRow as Lead } from "@/lib/leads"

export function LeadList({
  leads,
  minScore,
  loading,
  error,
  belowThresholdCount,
  revealed,
  onToggleReveal,
  hasMore,
  loadingMore,
  onLoadMore,
  filtersActive,
}: {
  leads: Lead[]
  minScore: number
  loading: boolean
  error: string | null
  belowThresholdCount: number
  revealed: boolean
  onToggleReveal: () => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  filtersActive: boolean
}) {
  if (error) {
    return <p className="text-destructive py-6 text-center text-sm">{error}</p>
  }

  // The previous result set stays rendered while the next one loads, so the
  // list never blanks between keystrokes. Only the very first load has nothing
  // to show.
  if (loading && leads.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">Loading leads…</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Say what the threshold is hiding. Silence here is indistinguishable
          from having no leads at all. */}
      {(belowThresholdCount > 0 || revealed) && (
        <button
          type="button"
          onClick={onToggleReveal}
          className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-left text-xs transition-colors"
        >
          {revealed
            ? `Hiding nothing — showing leads below your threshold (${minScore}).`
            : `${belowThresholdCount} lead${belowThresholdCount === 1 ? "" : "s"} below your threshold (${minScore}).`}{" "}
          <span className="text-primary underline">
            {revealed ? "Hide them" : "Show them"}
          </span>
        </button>
      )}

      {leads.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {filtersActive
            ? "No leads match these filters."
            : "No leads yet. Start a run to find some."}
        </p>
      ) : (
        <ul
          className={
            "flex flex-col gap-2 transition-opacity " + (loading ? "opacity-60" : "")
          }
        >
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} minScore={minScore} />
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  )
}
