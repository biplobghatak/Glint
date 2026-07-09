import type { RunState } from "@/lib/run"

/**
 * LinkedIn's own ceiling on people search: 1,000 results across 100 pages of
 * 10, for free and Premium accounts alike. `&page=101` returns nothing new.
 * Beyond it there is no more depth to be had from a single query — only a
 * differently-sliced query (by geo, industry, connection degree) would reach
 * further, and Glint does not slice.
 */
export const LINKEDIN_MAX_PAGE = 100

/**
 * Go as deep as LinkedIn allows, by default.
 *
 * This was 1, which is why a run only ever scanned the page it started on: the
 * navigate path below is correct and always was, but `page >= maxPages` was
 * true on the first page and stopped the run before it could ever fire.
 */
export const DEFAULT_MAX_PAGES = LINKEDIN_MAX_PAGE

export type StepDecision =
  | { kind: "scan" }
  | { kind: "navigate"; page: number }
  /** Paused. Do nothing and do not stop; a resume will re-drive this tab. */
  | { kind: "wait" }
  | { kind: "stop"; reason: string }

/**
 * The whole control flow of a run, as a pure function of its persisted state.
 *
 * Called by runPageStep to decide whether to scan, navigate, wait, or stop. A
 * pure function so it can be driven without a browser (testable). The order of
 * the checks is the contract:
 *
 * Pause outranks the caps, and the caps outrank a pending navigation.
 *
 * Pause first, because a paused run must be resumable into exactly the state it
 * paused in — reporting "reached lead limit" for a run the user paused would
 * destroy it. Caps before navigation, because a run that hit its lead cap on
 * page 2 would otherwise still load page 3 before noticing.
 */
export function nextAction(state: RunState, now: number): StepDecision {
  if (state.status === "paused") return { kind: "wait" }
  if (state.leadCount >= state.maxLeads) {
    return { kind: "stop", reason: "Reached lead limit" }
  }
  if (now - state.startedAt >= state.maxMinutes * 60_000) {
    return { kind: "stop", reason: "Reached time limit" }
  }
  if (state.phase === "scanning") return { kind: "scan" }
  if (state.page >= state.maxPages) {
    return { kind: "stop", reason: `Finished page ${state.page} of ${state.maxPages}` }
  }
  // Belt and braces: startRun clamps maxPages to LINKEDIN_MAX_PAGE, so this can
  // only fire for a run persisted by an older build. Navigating past it would
  // re-scan page 100's results under a page=101 URL and never terminate.
  if (state.page >= LINKEDIN_MAX_PAGE) {
    return {
      kind: "stop",
      reason: `LinkedIn caps search at ${LINKEDIN_MAX_PAGE} pages`,
    }
  }
  return { kind: "navigate", page: state.page + 1 }
}
