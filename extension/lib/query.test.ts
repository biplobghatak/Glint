import { describe, expect, it } from "vitest"
import { buildSearchUrl } from "./query"

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
