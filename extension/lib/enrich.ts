import type { RunState } from "@/lib/run"

/**
 * The `/in/<slug>` path of a LinkedIn profile URL, or null if it isn't one.
 *
 * The extractor stores a lead's `linkedin_url` as an absolute URL
 * (`https://www.linkedin.com/in/jane-doe`); enrichment needs just the profile
 * path so it can build the standalone contact-info overlay URL. A URL that
 * isn't a profile (or won't parse) yields null, and the caller simply doesn't
 * queue that lead for enrichment — better than opening a tab to a page that has
 * no contact info to find.
 */
export function profilePathFromUrl(
  linkedinUrl: string | null | undefined
): string | null {
  if (!linkedinUrl) return null
  try {
    const u = new URL(linkedinUrl)
    let path = u.pathname
    if (!/^\/in\/[^/]+/.test(path)) return null
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1)
    return path
  } catch {
    return null
  }
}

export type EnrichStep =
  | {
      kind: "enrich"
      index: number
      total: number
      leadId: string
      profilePath: string
      /** HUD line, e.g. "Looking up contact info… 2 of 3". */
      label: string
    }
  | { kind: "stop"; reason: string }
  | { kind: "done" }

/**
 * The next action of the enrichment pass, as a pure function of the run state
 * and the walk position — the enrichment-phase sibling of `nextAction`.
 *
 * Only the caps that can newly trip DURING enrichment are checked: Stop
 * (inactive) and the time cap. The lead cap is deliberately NOT here. Enrichment
 * never raises `leadCount`, and pagination (`nextAction`) enforces the lead cap
 * the instant this pass finishes — so re-checking it per lead would only strand
 * the very leads we just stored without their contact info, while still never
 * loading another page. Caps outrank pagination, not enrichment of work already
 * done.
 */
export function nextEnrichStep(
  state: RunState,
  index: number,
  now: number
): EnrichStep {
  if (!state.active) return { kind: "stop", reason: "Stopped" }
  if (now - state.startedAt >= state.maxMinutes * 60_000) {
    return { kind: "stop", reason: "Reached time limit" }
  }
  const queue = state.enrichQueue
  if (index >= queue.length) return { kind: "done" }
  const { leadId, profilePath } = queue[index]
  return {
    kind: "enrich",
    index,
    total: queue.length,
    leadId,
    profilePath,
    label: `Looking up contact info… ${index + 1} of ${queue.length}`,
  }
}
