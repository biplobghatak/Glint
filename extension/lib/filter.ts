// The one description of "which leads am I looking at". Both the filter bar and
// list-leads read this exact shape; extend it, never restructure it.

export type LeadStatus = "new" | "contacted" | "ignored"

export type LeadSort = "score_desc" | "score_asc" | "newest" | "oldest"

export type LeadFilter = {
  q: string // free text over name + company + role
  countries: string[] // ISO-3166 alpha-2; "" element = Unknown/null
  folderId: string | null // null = all; "" = unfiled
  status: LeadStatus[] // empty = all
  minScore: number | null // null = use icps.min_score server-side
  sort: LeadSort
}

// Every lead scored before the country migration has country = null, and
// score-lead's dedup branch returns before scoring, so ordinary browsing will
// never backfill them. "Unknown" is therefore a real, selectable value rather
// than the absence of one.
export const UNKNOWN_COUNTRY = ""

export const EMPTY_FILTER: LeadFilter = {
  q: "",
  countries: [],
  folderId: null,
  status: [],
  minScore: null,
  sort: "score_desc",
}

// An empty `countries` means "no country filter" — every lead, whatever its
// country, including null. It does NOT mean "match no country".
export function isCountryFilterActive(filter: LeadFilter): boolean {
  return filter.countries.length > 0
}

/**
 * Toggle one country chip.
 *
 * Turning on the *first* real country also turns on Unknown. Without that, a
 * user who clicks "US" instantly loses every lead they scored before the
 * country column existed — which is all of them, at the time of writing. That
 * reads as data loss, not as a filter. Unknown stays explicitly deselectable.
 */
export function toggleCountry(filter: LeadFilter, code: string): LeadFilter {
  if (filter.countries.includes(code)) {
    return { ...filter, countries: filter.countries.filter((c) => c !== code) }
  }
  const activatingFilter =
    filter.countries.length === 0 && code !== UNKNOWN_COUNTRY
  const next = activatingFilter
    ? [UNKNOWN_COUNTRY, code]
    : [...filter.countries, code]
  return { ...filter, countries: next }
}

export function countryLabel(code: string): string {
  if (code === UNKNOWN_COUNTRY) return "Unknown"
  // Intl.DisplayNames turns "DE" into "Germany" without shipping a lookup
  // table. It throws on codes it can't resolve, so fall back to the raw code.
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" })
    return names.of(code) ?? code
  } catch {
    return code
  }
}
