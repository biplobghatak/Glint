import { describe, expect, it } from "vitest"
import { isLinkedIn, isPreNavigation } from "./linkedin"

describe("isLinkedIn", () => {
  it("accepts www and bare linkedin.com", () => {
    expect(isLinkedIn("https://www.linkedin.com/feed/")).toBe(true)
    expect(isLinkedIn("https://linkedin.com/in/jane")).toBe(true)
  })
  it("accepts a search results URL with a page param", () => {
    expect(
      isLinkedIn("https://www.linkedin.com/search/results/people/?keywords=x&page=7")
    ).toBe(true)
  })
  it("rejects other origins", () => {
    expect(isLinkedIn("https://example.com/linkedin.com/")).toBe(false)
    expect(isLinkedIn("http://www.linkedin.com/feed/")).toBe(false)
  })
  it("rejects undefined and about:blank", () => {
    expect(isLinkedIn(undefined)).toBe(false)
    expect(isLinkedIn("about:blank")).toBe(false)
  })
})

describe("isPreNavigation", () => {
  // The regression this exists for: the run's window is created on about:blank,
  // and tabs.onUpdated for that commit can land after glint_run is written but
  // before the search URL is applied. Reading about:blank as "navigated off
  // LinkedIn" paused every run one instant before its results page loaded, so
  // the content script arrived on a good page and correctly refused to drive it.
  it("is true for a tab that has not committed a navigation", () => {
    expect(isPreNavigation("about:blank")).toBe(true)
    expect(isPreNavigation(undefined)).toBe(true)
    expect(isPreNavigation("")).toBe(true)
  })

  it("is false for any real page, LinkedIn or not", () => {
    expect(isPreNavigation("https://www.linkedin.com/search/results/people/")).toBe(false)
    expect(isPreNavigation("https://example.com/")).toBe(false)
  })

  // "Not LinkedIn" and "not anywhere yet" must stay distinct: only the first is
  // evidence that a run lost its tab.
  it("separates a fresh tab from a tab that left LinkedIn", () => {
    const fresh = "about:blank"
    const wandered = "https://example.com/"
    expect(isLinkedIn(fresh)).toBe(false)
    expect(isLinkedIn(wandered)).toBe(false)
    expect(isPreNavigation(fresh)).toBe(true)
    expect(isPreNavigation(wandered)).toBe(false)
  })
})
