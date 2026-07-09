import {
  countryLabel,
  toggleCountry,
  UNKNOWN_COUNTRY,
  type LeadFilter,
  type LeadSort,
} from "@/lib/filter"

const SORT_LABELS: Record<LeadSort, string> = {
  score_desc: "Highest score",
  score_asc: "Lowest score",
  newest: "Newest",
  oldest: "Oldest",
}

const chipClass = (active: boolean) =>
  "rounded-full border px-2 py-0.5 text-xs transition-colors " +
  (active
    ? "border-primary bg-primary text-primary-foreground"
    : "border-border bg-card text-muted-foreground hover:bg-accent")

export function FilterBar({
  filter,
  onChange,
  query,
  onQueryChange,
  countries,
  minScore,
  onMinScoreChange,
}: {
  filter: LeadFilter
  onChange: (next: LeadFilter) => void
  /** Raw, undebounced input value. filter.q lags it by the debounce interval. */
  query: string
  onQueryChange: (value: string) => void
  /** Chip set: the ICP's target geography unioned with countries seen on loaded rows. */
  countries: string[]
  /** The user's saved icps.min_score, not a per-request override. */
  minScore: number
  onMinScoreChange: (value: number) => void
}) {
  return (
    <div className="border-border flex flex-col gap-3 border-b pb-3">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search name, company, or role"
        aria-label="Search leads"
        className="border-border bg-card focus-visible:ring-ring rounded-[var(--radius)] border px-3 py-1.5 text-sm outline-none focus-visible:ring-2"
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Country</span>
          {filter.countries.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...filter, countries: [] })}
              className="text-muted-foreground hover:text-foreground text-xs underline"
            >
              All countries
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {/* Unknown is listed first and is included automatically the moment
              the user activates the country filter. Every lead scored before
              the country column existed has country = null; a filter that
              dropped them all silently would read as data loss. */}
          {[UNKNOWN_COUNTRY, ...countries].map((code) => {
            const active = filter.countries.includes(code)
            return (
              <button
                key={code || "unknown"}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(toggleCountry(filter, code))}
                className={chipClass(active)}
              >
                {countryLabel(code)}
              </button>
            )
          })}
        </div>
        {filter.countries.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Showing every country, including leads with no country.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="min-score" className="text-xs font-medium">
            Score threshold
          </label>
          <span className="text-muted-foreground text-xs tabular-nums">{minScore}</span>
        </div>
        {/* 0-100. score-lead prompts for and stores 0-100; nothing divides by
            10, so a "greater than 7" threshold would hide almost nothing. */}
        <input
          id="min-score"
          type="range"
          min={0}
          max={100}
          step={5}
          value={minScore}
          onChange={(e) => onMinScoreChange(Number(e.target.value))}
          className="accent-primary w-full"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="sort" className="text-xs font-medium">
          Sort
        </label>
        <select
          id="sort"
          value={filter.sort}
          onChange={(e) => onChange({ ...filter, sort: e.target.value as LeadSort })}
          className="border-border bg-card flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs outline-none"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Wired to the same LeadFilter object; Phase 2 creates leads.folder_id
          and the manage-folders function, and enables this. */}
      <div className="flex items-center gap-2">
        <label htmlFor="folder" className="text-muted-foreground text-xs font-medium">
          Folder
        </label>
        <select
          id="folder"
          disabled
          title="Folders arrive in the next release"
          className="border-border bg-card text-muted-foreground flex-1 cursor-not-allowed rounded-[var(--radius)] border px-2 py-1 text-xs opacity-60"
        >
          <option>All folders</option>
        </select>
      </div>
    </div>
  )
}
