import { describe, expect, it, vi } from "vitest"
import { pairResultsToCards, type BatchScore } from "./score"
import type { LeadCandidate } from "./extract"

function cand(partial: Partial<LeadCandidate>): LeadCandidate {
  return {
    name: partial.name ?? null,
    headline: partial.headline ?? null,
    company: partial.company ?? null,
    location: partial.location ?? null,
    post_text: partial.post_text ?? null,
    linkedin_url: partial.linkedin_url ?? null,
    source: partial.source ?? "search_result",
    avatar_url: partial.avatar_url ?? null,
  }
}

function score(partial: Partial<BatchScore>): BatchScore {
  return {
    linkedin_url: partial.linkedin_url ?? null,
    lead_id: partial.lead_id,
    match_score: partial.match_score ?? 80,
    match_reasons: partial.match_reasons ?? [],
    min_score: partial.min_score ?? 70,
    stored: partial.stored ?? true,
    inserted: partial.inserted ?? true,
  }
}

describe("pairResultsToCards", () => {
  it("pairs each card with the result at its position", () => {
    const pending = [
      { node: "A", cand: cand({ linkedin_url: "https://x/in/a" }) },
      { node: "B", cand: cand({ linkedin_url: "https://x/in/b" }) },
    ]
    const results = [
      score({ linkedin_url: "https://x/in/a", match_score: 90 }),
      score({ linkedin_url: "https://x/in/b", match_score: 60 }),
    ]
    const paired = pairResultsToCards(pending, results)
    expect(paired.map((p) => p.node)).toEqual(["A", "B"])
    expect(paired[0].result.match_score).toBe(90)
    expect(paired[1].result.match_score).toBe(60)
  })

  it("skips a card whose sent and echoed linkedin_url disagree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const pending = [
      { node: "A", cand: cand({ linkedin_url: "https://x/in/a" }) },
      { node: "B", cand: cand({ linkedin_url: "https://x/in/b" }) },
    ]
    // Second result carries the wrong person's URL — must not land on card B.
    const results = [
      score({ linkedin_url: "https://x/in/a" }),
      score({ linkedin_url: "https://x/in/c" }),
    ]
    const paired = pairResultsToCards(pending, results)
    expect(paired.map((p) => p.node)).toEqual(["A"])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("pairs by position when either side has a null url (nothing to assert)", () => {
    const pending = [
      { node: "A", cand: cand({ linkedin_url: null, name: "Ann" }) },
      { node: "B", cand: cand({ linkedin_url: "https://x/in/b" }) },
    ]
    // A sent no url; B's echoed url is null. Neither pair can be asserted, so
    // both are kept on position.
    const results = [
      score({ linkedin_url: null, match_score: 55 }),
      score({ linkedin_url: null, match_score: 88 }),
    ]
    const paired = pairResultsToCards(pending, results)
    expect(paired.map((p) => p.node)).toEqual(["A", "B"])
    expect(paired[0].result.match_score).toBe(55)
    expect(paired[1].result.match_score).toBe(88)
  })

  it("leaves trailing cards unpaired when results are shorter than pending", () => {
    const pending = [
      { node: "A", cand: cand({ linkedin_url: "https://x/in/a" }) },
      { node: "B", cand: cand({ linkedin_url: "https://x/in/b" }) },
      { node: "C", cand: cand({ linkedin_url: "https://x/in/c" }) },
    ]
    // The endpoint dropped the last profile (model omitted it). The kept cards
    // still align because the drop was at the tail.
    const results = [
      score({ linkedin_url: "https://x/in/a" }),
      score({ linkedin_url: "https://x/in/b" }),
    ]
    const paired = pairResultsToCards(pending, results)
    expect(paired.map((p) => p.node)).toEqual(["A", "B"])
  })

  it("returns an empty array for no results", () => {
    const pending = [{ node: "A", cand: cand({ linkedin_url: "https://x/in/a" }) }]
    expect(pairResultsToCards(pending, [])).toEqual([])
  })
})
