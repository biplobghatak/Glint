import type { SuggestionRow } from "@/lib/suggestions"

function subtitle(s: SuggestionRow): string {
  return [s.role, s.company].filter(Boolean).join(" · ")
}

export function SuggestionStrip({
  suggestions,
  loading,
  error,
  collapsed,
  onToggleCollapsed,
  onViewProfile,
  onMessage,
  draftingId,
  onRunSearch,
}: {
  suggestions: SuggestionRow[]
  loading: boolean
  error: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onViewProfile: (s: SuggestionRow) => void
  onMessage: (s: SuggestionRow) => void
  draftingId: string | null
  onRunSearch: () => void
}) {
  const count = suggestions.length

  return (
    <section className="border-border bg-card flex flex-col gap-2 rounded-[var(--radius)] border p-3">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-medium">
          Suggested for you{count > 0 && !loading ? ` (${count})` : ""}
        </span>
        <span className="text-muted-foreground text-xs">{collapsed ? "Show" : "Hide"}</span>
      </button>

      {!collapsed && (
        <>
          {loading && <p className="text-muted-foreground text-xs">Finding leads…</p>}

          {!loading && error && <p className="text-destructive text-xs">{error}</p>}

          {/* A new user has zero scored leads, and this strip is the first thing
              they see — exactly when they decide whether the product works. An
              empty strip reads as broken; a prompt reads as ready. */}
          {!loading && !error && count === 0 && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-xs">
                No suggestions yet. Run a search and Glint will score leads against
                your ICP.
              </p>
              <button
                type="button"
                onClick={onRunSearch}
                className="bg-primary text-primary-foreground rounded-[var(--radius)] px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-90"
              >
                Run a search
              </button>
            </div>
          )}

          {!loading && !error && count > 0 && (
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="border-border flex flex-col gap-1.5 rounded-[var(--radius)] border p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name ?? "Unknown"}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {subtitle(s)}
                      </p>
                    </div>
                    <span className="text-primary shrink-0 text-sm font-semibold tabular-nums">
                      {s.match_score}
                    </span>
                  </div>

                  {/* The single most useful thing Glint knows about this lead,
                      and it was already computed at scoring time. */}
                  {s.match_reasons?.[0] && (
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {s.match_reasons[0]}
                    </p>
                  )}

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onViewProfile(s)}
                      className="border-border bg-background hover:bg-accent flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs transition-colors"
                    >
                      View profile
                    </button>
                    <button
                      type="button"
                      onClick={() => onMessage(s)}
                      disabled={draftingId !== null}
                      className="bg-primary text-primary-foreground flex-1 rounded-[var(--radius)] px-2 py-1 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {draftingId === s.id ? "Drafting…" : "Message"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
