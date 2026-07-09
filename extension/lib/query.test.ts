import { describe, expect, it } from "vitest"
import { buildSearchUrl, isRunPage } from "./query"

const parsed = { title: "CTO", keywords: "fintech", location: "Berlin" }

describe("buildSearchUrl", () => {
  // Page 1 must stay byte-identical to what shipped, or every existing run
  // silently changes its URL.
  it("omits the page param for page 1", () => {
    const url = buildSearchUrl(parsed)
    expect(url).not.toContain("page=")
    expect(buildSearchUrl(parsed, 1)).toBe(url)
  })

  it("appends page=N for later pages", () => {
    expect(new URL(buildSearchUrl(parsed, 3)).searchParams.get("page")).toBe("3")
  })

  it("keeps keywords and title alongside the page", () => {
    const params = new URL(buildSearchUrl(parsed, 2)).searchParams
    expect(params.get("keywords")).toBe("fintech Berlin")
    expect(params.get("title")).toBe("CTO")
    expect(params.get("page")).toBe("2")
  })
})

describe("isRunPage", () => {
  it("accepts the URL buildSearchUrl produced", () => {
    expect(isRunPage(parsed, 1, buildSearchUrl(parsed, 1))).toBe(true)
    expect(isRunPage(parsed, 4, buildSearchUrl(parsed, 4))).toBe(true)
  })

  // LinkedIn appends its own tracking params on navigation, so a byte comparison
  // would call the run's own page foreign the instant it landed.
  it("ignores params it did not set", () => {
    const url = `${buildSearchUrl(parsed, 2)}&origin=SWITCH_SEARCH_VERTICAL&sid=abc`
    expect(isRunPage(parsed, 2, url)).toBe(true)
  })

  // The run's tab may be sitting on a *different* search when glint_run is
  // written into it. Scoring those cards would file the wrong people.
  it("rejects another query's results", () => {
    const other = { title: "CTO", keywords: "healthcare", location: "Berlin" }
    expect(isRunPage(parsed, 1, buildSearchUrl(other, 1))).toBe(false)
  })

  it("rejects the same query with a different title", () => {
    const other = { ...parsed, title: "CEO" }
    expect(isRunPage(parsed, 1, buildSearchUrl(other, 1))).toBe(false)
  })

  it("rejects the right query on the wrong page", () => {
    expect(isRunPage(parsed, 2, buildSearchUrl(parsed, 3))).toBe(false)
  })

  // buildSearchUrl omits `page` for page 1, but LinkedIn serves page 1 at both
  // spellings. A run resumed onto an explicit ?page=1 must still drive.
  it("treats an absent page param as page 1", () => {
    const explicit = `${buildSearchUrl(parsed, 1)}&page=1`
    expect(isRunPage(parsed, 1, explicit)).toBe(true)
  })

  it("rejects any page that is not the people search results", () => {
    expect(isRunPage(parsed, 1, "https://www.linkedin.com/feed/")).toBe(false)
    expect(isRunPage(parsed, 1, "https://www.linkedin.com/in/someone/")).toBe(false)
    expect(
      isRunPage(parsed, 1, "https://www.linkedin.com/search/results/companies/?keywords=fintech+Berlin&title=CTO")
    ).toBe(false)
  })

  it("rejects a non-URL without throwing", () => {
    expect(isRunPage(parsed, 1, "about:blank")).toBe(false)
    expect(isRunPage(parsed, 1, "")).toBe(false)
  })
})
