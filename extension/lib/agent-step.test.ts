import { describe, expect, it } from "vitest"
import { LINKEDIN_MAX_PAGE, nextAction } from "./agent-step"
import type { RunState } from "./run"

const START = 1_000_000
const base: RunState = {
  status: "running",
  pauseReason: null,
  tabId: 1,
  windowId: 10,
  query: "q",
  parsed: { title: "", keywords: "q", location: "" },
  startedAt: START,
  leadCount: 0,
  maxLeads: 1000,
  maxMinutes: 240,
  page: 1,
  maxPages: 1,
  folderId: null,
  siteId: null,
  seen: [],
  phase: "scanning",
}

describe("nextAction", () => {
  it("scans while scanning", () => {
    expect(nextAction(base, START)).toEqual({ kind: "scan" })
  })

  it("stops on the lead cap, ahead of anything else", () => {
    const s = { ...base, leadCount: 1000 }
    expect(nextAction(s, START)).toEqual({ kind: "stop", reason: "Reached lead limit" })
  })

  it("stops on the time cap", () => {
    expect(nextAction(base, START + 240 * 60_000)).toEqual({
      kind: "stop",
      reason: "Reached time limit",
    })
  })

  it("stops after the last page rather than navigating", () => {
    const s: RunState = { ...base, phase: "paginating", page: 1, maxPages: 1 }
    expect(nextAction(s, START)).toEqual({ kind: "stop", reason: "Finished page 1 of 1" })
  })

  it("navigates to the next page when pages remain", () => {
    const s: RunState = { ...base, phase: "paginating", page: 1, maxPages: 3 }
    expect(nextAction(s, START)).toEqual({ kind: "navigate", page: 2 })
  })

  it("navigates from the middle of a range", () => {
    const s: RunState = { ...base, phase: "paginating", page: 2, maxPages: 3 }
    expect(nextAction(s, START)).toEqual({ kind: "navigate", page: 3 })
  })

  // The regression this whole change exists to prevent: with maxPages defaulting
  // to LinkedIn's own ceiling, a run must keep walking deep into the results.
  it("keeps paginating deep into a full-depth run", () => {
    const s: RunState = {
      ...base,
      phase: "paginating",
      page: 47,
      maxPages: LINKEDIN_MAX_PAGE,
    }
    expect(nextAction(s, START)).toEqual({ kind: "navigate", page: 48 })
  })

  // A cap must beat a pending navigation, or a run overshoots by a whole page.
  it("prefers the lead cap over navigating", () => {
    const s: RunState = { ...base, phase: "paginating", page: 1, maxPages: 5, leadCount: 1000 }
    expect(nextAction(s, START)).toEqual({ kind: "stop", reason: "Reached lead limit" })
  })

  // Only reachable from a run persisted by a build that didn't clamp maxPages.
  // Without it, page 101 re-scans page 100's results forever.
  it("stops at LinkedIn's own page ceiling even if maxPages exceeds it", () => {
    const s: RunState = {
      ...base,
      phase: "paginating",
      page: LINKEDIN_MAX_PAGE,
      maxPages: 500,
    }
    expect(nextAction(s, START)).toEqual({
      kind: "stop",
      reason: `LinkedIn caps search at ${LINKEDIN_MAX_PAGE} pages`,
    })
  })

  it("waits while paused rather than scanning", () => {
    const s: RunState = { ...base, status: "paused", pauseReason: "hidden" }
    expect(nextAction(s, START)).toEqual({ kind: "wait" })
  })

  // Pause outranks every cap. A run paused after hitting its lead count must
  // resume as a paused run, not be destroyed with "Reached lead limit" — the
  // user paused it, and the reason they see must be the one they caused.
  it("prefers waiting over the caps when paused", () => {
    const s: RunState = {
      ...base,
      status: "paused",
      pauseReason: "user",
      leadCount: 1000,
    }
    expect(nextAction(s, START + 999 * 60_000)).toEqual({ kind: "wait" })
  })
})
