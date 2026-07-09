import type { RunState } from "@/lib/run"

/** Page 1 only, by default. The panel exposes 1-10. */
export const DEFAULT_MAX_PAGES = 1

export type StepDecision =
  | { kind: "scan" }
  | { kind: "navigate"; page: number }
  | { kind: "stop"; reason: string }

/**
 * The whole control flow of a run, as a pure function of its persisted state.
 *
 * Extracted from runAgentLoop so it can be driven without a browser. The order
 * of the checks is the contract: caps outrank everything, including a pending
 * navigation -- otherwise a run that hit its lead cap on page 2 would still
 * load page 3 before noticing.
 */
export function nextAction(state: RunState, now: number): StepDecision {
  if (!state.active) return { kind: "stop", reason: "Stopped" }
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
  return { kind: "navigate", page: state.page + 1 }
}
