import { useState, type FormEvent } from "react"
import {
  countryLabel,
  toggleCountry,
  UNKNOWN_COUNTRY,
  type LeadFilter,
  type LeadSort,
} from "@/lib/filter"
import type { FolderRow } from "@/lib/folders"

const SORT_LABELS: Record<LeadSort, string> = {
  score_desc: "Highest score",
  score_asc: "Lowest score",
  newest: "Newest",
  oldest: "Oldest",
}

// A <select> value is always a string, so `null` (all folders) and `""`
// (unfiled) cannot both be expressed natively — "" is what the DOM reports for
// an option with no value. These sentinels keep the three states distinct
// across the DOM boundary and are mapped back before touching LeadFilter.
const ALL_FOLDERS = "__all"
const UNFILED = "__unfiled"

function toSelectValue(folderId: string | null): string {
  if (folderId === null) return ALL_FOLDERS
  if (folderId === "") return UNFILED
  return folderId
}

function fromSelectValue(value: string): string | null {
  if (value === ALL_FOLDERS) return null
  if (value === UNFILED) return ""
  return value
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
  folders,
  onCreateFolder,
  creatingFolder,
  createFolderError,
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
  folders: FolderRow[]
  /** Resolves true when the folder was created. */
  onCreateFolder: (name: string) => Promise<boolean>
  creatingFolder: boolean
  /** The server's message on a duplicate name (409), shown next to the input. */
  createFolderError: string | null
}) {
  const [newFolder, setNewFolder] = useState("")

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newFolder.trim()
    if (!name || creatingFolder) return
    // Cleared only once the server has accepted it. Clearing optimistically
    // would throw away what the user typed on a duplicate-name 409, right when
    // they need to edit it.
    if (await onCreateFolder(name)) setNewFolder("")
  }

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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <label htmlFor="folder" className="text-xs font-medium">
            Folder
          </label>
          <select
            id="folder"
            value={toSelectValue(filter.folderId)}
            onChange={(e) =>
              onChange({ ...filter, folderId: fromSelectValue(e.target.value) })
            }
            className="border-border bg-card focus-visible:ring-ring flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs outline-none focus-visible:ring-2"
          >
            <option value={ALL_FOLDERS}>All folders</option>
            {/* Unfiled is always present. Every lead that existed before the
                folders migration has folder_id = null; if this weren't
                reachable the migration would look like it ate the inbox. */}
            <option value={UNFILED}>Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.lead_count})
              </option>
            ))}
          </select>
        </div>

        {/* Create only. Rename and delete live in the web app: this is a 400px
            working surface, not a management one. */}
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="New folder"
            aria-label="New folder name"
            maxLength={60}
            className="border-border bg-card focus-visible:ring-ring min-w-0 flex-1 rounded-[var(--radius)] border px-2 py-1 text-xs outline-none focus-visible:ring-2"
          />
          <button
            type="submit"
            disabled={newFolder.trim().length === 0 || creatingFolder}
            className="border-border bg-card hover:bg-accent shrink-0 rounded-[var(--radius)] border px-2 py-1 text-xs transition-colors disabled:opacity-50"
          >
            {creatingFolder ? "Adding…" : "Add"}
          </button>
        </form>
        {createFolderError && (
          <p className="text-destructive text-xs">{createFolderError}</p>
        )}
      </div>
    </div>
  )
}
