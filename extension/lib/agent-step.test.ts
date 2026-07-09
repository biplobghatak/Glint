import { describe, expect, it } from "vitest"
import { nextAction } from "./agent-step"
import type { RunState } from "./run"

const START = 1_000_000
const base: RunState = {
  active: true,
  tabId: 1,
  query: "q",
  parsed: { title: "", keywords: "q", location: "" },
  startedAt: START,
  leadCount: 0,
  maxLeads: 100,
  maxMinutes: 20,
  page: 1,
  maxPages: 1,
  folderId: null,
  seen: [],
  enrichQueue: [],
  openedTabIds: [],
  phase: "scanning",
}

describe("nextAction", () => {
  it("scans while scanning", () => {
    expect(nextAction(base, START)).toEqual({ kind: "scan" })
  })

  it("stops on the lead cap, ahead of anything else", () => {
    const s = { ...base, leadCount: 100 }
    expect(nextAction(s, START)).toEqual({ kind: "stop", reason: "Reached lead limit" })
  })

  it("stops on the time cap", () => {
    expect(nextAction(base, START + 20 * 60_000)).toEqual({
      kind: "stop",
      reason: "Reached time limit",
    })
  })

  // The default. maxPages=1 means slice 1 never issues a page-2 navigation,
  // which is why the &page=N verification gate does not block shipping.
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

  // A cap must beat a pending navigation, or a run overshoots by a whole page.
  it("prefers the lead cap over navigating", () => {
    const s: RunState = { ...base, phase: "paginating", page: 1, maxPages: 5, leadCount: 100 }
    expect(nextAction(s, START)).toEqual({ kind: "stop", reason: "Reached lead limit" })
  })

  it("stops an inactive run", () => {
    expect(nextAction({ ...base, active: false }, START)).toEqual({
      kind: "stop",
      reason: "Stopped",
    })
  })
})
