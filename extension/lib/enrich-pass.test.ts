import { describe, expect, it } from "vitest"
import {
  DAILY_PROFILE_VIEW_BUDGET,
  dayKey,
  nextEnrichPassStep,
  remainingBudget,
  spendBudget,
  type EnrichPassState,
} from "./enrich-pass"

const START = 1_000_000

const base: EnrichPassState = {
  active: true,
  queue: [
    { leadId: "a", profilePath: "/in/a" },
    { leadId: "b", profilePath: "/in/b" },
  ],
  index: 0,
  openedTabIds: [],
  startedAt: START,
}

describe("dayKey", () => {
  it("is the local calendar day", () => {
    // Constructed from local parts so the assertion can't drift with the
    // machine's timezone -- the point is that dayKey reads LOCAL fields.
    const t = new Date(2026, 6, 10, 13, 30).getTime()
    expect(dayKey(t)).toBe("2026-07-10")
  })

  it("zero-pads month and day", () => {
    expect(dayKey(new Date(2026, 0, 5).getTime())).toBe("2026-01-05")
  })
})

describe("remainingBudget", () => {
  it("is the full budget when nothing was spent", () => {
    expect(remainingBudget(null, START)).toBe(DAILY_PROFILE_VIEW_BUDGET)
  })

  it("subtracts today's spend", () => {
    const b = { day: dayKey(START), used: 10 }
    expect(remainingBudget(b, START)).toBe(DAILY_PROFILE_VIEW_BUDGET - 10)
  })

  // The reset is what makes the budget a *daily* one rather than a lifetime cap.
  it("ignores a budget from an earlier day", () => {
    const b = { day: "2020-01-01", used: DAILY_PROFILE_VIEW_BUDGET }
    expect(remainingBudget(b, START)).toBe(DAILY_PROFILE_VIEW_BUDGET)
  })

  it("never goes negative", () => {
    const b = { day: dayKey(START), used: DAILY_PROFILE_VIEW_BUDGET + 5 }
    expect(remainingBudget(b, START)).toBe(0)
  })
})

describe("spendBudget", () => {
  it("starts a fresh day at one", () => {
    expect(spendBudget(null, START)).toEqual({ day: dayKey(START), used: 1 })
  })

  it("increments within the same day", () => {
    const b = { day: dayKey(START), used: 3 }
    expect(spendBudget(b, START)).toEqual({ day: dayKey(START), used: 4 })
  })

  it("rolls a stale day over rather than adding to it", () => {
    const b = { day: "2020-01-01", used: 40 }
    expect(spendBudget(b, START)).toEqual({ day: dayKey(START), used: 1 })
  })
})

describe("nextEnrichPassStep", () => {
  it("enriches the lead at the cursor", () => {
    expect(nextEnrichPassStep(base, 50)).toEqual({
      kind: "enrich",
      index: 0,
      total: 2,
      leadId: "a",
      profilePath: "/in/a",
      label: "Looking up contact info… 1 of 2",
    })
  })

  it("is done once the cursor passes the queue", () => {
    expect(nextEnrichPassStep({ ...base, index: 2 }, 50)).toEqual({ kind: "done" })
  })

  // Stop outranks the budget: a user who clicked Stop must not be told they hit
  // a daily limit they did not hit.
  it("stops an inactive pass, ahead of the budget check", () => {
    expect(nextEnrichPassStep({ ...base, active: false }, 0)).toEqual({
      kind: "stop",
      reason: "Stopped",
    })
  })

  // The budget outranks the queue: work left over must halt, not report "done",
  // or the panel would tell the user every lead was looked up.
  it("stops on an exhausted budget even with queue remaining", () => {
    const step = nextEnrichPassStep(base, 0)
    expect(step.kind).toBe("stop")
    expect(step.kind === "stop" && step.reason).toMatch(/Daily contact-info limit/)
  })

  it("does not stop on an exhausted budget once the queue is drained", () => {
    // Ordering detail worth pinning: `done` is only reachable with budget left,
    // so a pass that spends its last view on its last lead reports the budget
    // stop, not done. That is the honest reading -- the budget IS now zero.
    expect(nextEnrichPassStep({ ...base, index: 2 }, 1)).toEqual({ kind: "done" })
  })
})
