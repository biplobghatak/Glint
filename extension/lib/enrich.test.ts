import { describe, expect, it } from "vitest"
import { nextEnrichStep, profilePathFromUrl } from "./enrich"
import type { RunState } from "./run"

describe("profilePathFromUrl", () => {
  it("extracts the /in/ path from an absolute profile URL", () => {
    expect(profilePathFromUrl("https://www.linkedin.com/in/jane-doe")).toBe(
      "/in/jane-doe"
    )
  })
  it("strips a trailing slash", () => {
    expect(profilePathFromUrl("https://www.linkedin.com/in/jane-doe/")).toBe(
      "/in/jane-doe"
    )
  })
  it("keeps sub-path segments (miniProfile variants) intact", () => {
    expect(
      profilePathFromUrl("https://www.linkedin.com/in/jane-doe/detail/")
    ).toBe("/in/jane-doe/detail")
  })
  it("rejects a non-profile URL", () => {
    expect(profilePathFromUrl("https://www.linkedin.com/company/acme")).toBeNull()
  })
  it("returns null for null/empty input", () => {
    expect(profilePathFromUrl(null)).toBeNull()
    expect(profilePathFromUrl(undefined)).toBeNull()
    expect(profilePathFromUrl("")).toBeNull()
  })
  it("returns null for an unparseable URL", () => {
    expect(profilePathFromUrl("not a url")).toBeNull()
  })
})

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
  siteId: null,
  seen: [],
  enrichQueue: [
    { leadId: "a", profilePath: "/in/a" },
    { leadId: "b", profilePath: "/in/b" },
    { leadId: "c", profilePath: "/in/c" },
  ],
  openedTabIds: [],
  phase: "enriching",
}

describe("nextEnrichStep", () => {
  it("returns the queued lead with a 1-based announced label", () => {
    expect(nextEnrichStep(base, 1, START)).toEqual({
      kind: "enrich",
      index: 1,
      total: 3,
      leadId: "b",
      profilePath: "/in/b",
      label: "Looking up contact info… 2 of 3",
    })
  })

  it("reports done past the end of the queue", () => {
    expect(nextEnrichStep(base, 3, START)).toEqual({ kind: "done" })
  })

  it("stops an inactive (Stopped) run", () => {
    expect(nextEnrichStep({ ...base, active: false }, 0, START)).toEqual({
      kind: "stop",
      reason: "Stopped",
    })
  })

  it("stops on the time cap, abandoning the rest of the queue", () => {
    expect(nextEnrichStep(base, 0, START + 20 * 60_000)).toEqual({
      kind: "stop",
      reason: "Reached time limit",
    })
  })

  // The lead cap must NOT interrupt enrichment: leads already stored still get
  // their contact info, and pagination stops the run afterwards regardless.
  it("keeps enriching at the lead cap (the cap gates pagination, not this pass)", () => {
    const atCap = { ...base, leadCount: base.maxLeads }
    expect(nextEnrichStep(atCap, 0, START)).toMatchObject({ kind: "enrich" })
  })
})
