import { describe, expect, it } from "vitest"
import { buildSearchUrl, composeKeywords, isRunPage } from "./query"

const parsed = { title: "CTO", keywords: "fintech", location: "Berlin" }

describe("composeKeywords", () => {
  // The live bug, verbatim. "Find me Agency owner in United Kingdom" produced
  // `agency owner OR agency partner OR agency founder United Kingdom`, which
  // LinkedIn parsed as `A OR B OR (C AND United AND Kingdom)` -- so two of the
  // three alternatives searched the entire planet.
  it("constrains every alternative to the location, not just the last", () => {
    expect(
      composeKeywords(
        "agency owner OR agency partner OR agency founder",
        "United Kingdom"
      )
    ).toBe(
      '("agency owner" OR "agency partner" OR "agency founder") AND "United Kingdom"'
    )
  })

  // A single word is left bare: quoting it would suppress LinkedIn's stemming
  // for no benefit. Only phrases need the quotes.
  it("quotes phrases but leaves single words unquoted", () => {
    expect(composeKeywords("dtc brand OR shopify", "")).toBe('("dtc brand" OR shopify)')
    expect(composeKeywords("fintech", "Berlin")).toBe("fintech AND Berlin")
    expect(composeKeywords("agency owner", "Berlin")).toBe('"agency owner" AND Berlin')
  })

  // The group is kept even with nothing ANDed onto it today, so that adding a
  // location (or any future term) cannot silently re-associate the ORs.
  it("parenthesises the OR group but not a lone alternative", () => {
    expect(composeKeywords("shopify OR ecommerce", "")).toBe("(shopify OR ecommerce)")
    expect(composeKeywords("fintech", "")).toBe("fintech")
  })

  it("trusts grouping the model supplied itself", () => {
    const grouped = "(founder OR owner) AND (agency OR studio)"
    expect(composeKeywords(grouped, "United Kingdom")).toBe(
      `${grouped} AND "United Kingdom"`
    )
  })

  it("handles either side being absent", () => {
    expect(composeKeywords("", "United Kingdom")).toBe('"United Kingdom"')
    expect(composeKeywords("fintech OR saas", "")).toBe("(fintech OR saas)")
    expect(composeKeywords("", "")).toBe("")
    expect(composeKeywords("   ", "  ")).toBe("")
  })

  // An interior quote would close the phrase early and hand LinkedIn a
  // malformed expression.
  it("neutralises interior quotes rather than escaping them", () => {
    expect(composeKeywords('agency "owner"', "")).toBe('"agency owner"')
  })

  it("ignores a lowercase or, which LinkedIn treats as a search word", () => {
    expect(composeKeywords("this or that", "")).toBe('"this or that"')
  })
})

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
    // The location is ANDed, not concatenated. See composeKeywords.
    expect(params.get("keywords")).toBe("fintech AND Berlin")
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
