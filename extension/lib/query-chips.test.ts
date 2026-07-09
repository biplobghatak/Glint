import { describe, expect, it } from "vitest"
import { isChipSelected, toggleChip } from "./query-chips"

describe("toggleChip — appending", () => {
  it("appends a role bare to an empty query", () => {
    expect(toggleChip("", "VP Engineering", "role")).toBe("VP Engineering")
  })

  it("appends a role with a space onto an existing query", () => {
    expect(toggleChip("VP Engineering at fintech", "Head of Data", "role")).toBe(
      "VP Engineering at fintech Head of Data"
    )
  })

  it("introduces `at` for the first company type", () => {
    expect(toggleChip("VP Engineering", "fintech", "company")).toBe(
      "VP Engineering at fintech"
    )
  })

  it("appends a second company type after a comma, not a second `at`", () => {
    expect(toggleChip("VP Engineering at fintech", "SaaS", "company")).toBe(
      "VP Engineering at fintech, SaaS"
    )
  })

  it("introduces `in` for a country", () => {
    expect(toggleChip("VP Engineering at fintech", "Germany", "country")).toBe(
      "VP Engineering at fintech in Germany"
    )
  })

  it("appends a second country after a comma, not a second `in`", () => {
    expect(
      toggleChip("VP Engineering at fintech in Germany", "France", "country")
    ).toBe("VP Engineering at fintech in Germany, France")
  })
})

describe("isChipSelected", () => {
  it("is case-insensitive", () => {
    expect(isChipSelected("cto of fintech", "CTO")).toBe(true)
    expect(isChipSelected("VP ENGINEERING", "vp engineering")).toBe(true)
  })

  it("respects word boundaries — CTO is not selected inside CTOs", () => {
    expect(isChipSelected("CTOs of fintech", "CTO")).toBe(false)
  })

  it("matches a whole-word occurrence", () => {
    expect(isChipSelected("VP Engineering at fintech", "fintech")).toBe(true)
    expect(isChipSelected("VP Engineering at fintech", "SaaS")).toBe(false)
  })

  it("matches text containing regex metacharacters literally", () => {
    expect(isChipSelected("we hire C++ engineers", "C++")).toBe(true)
    // Matched literally, not as the pattern /C++/ (one C, one-or-more +).
    expect(isChipSelected("we hire Cengineers", "C++")).toBe(false)
    expect(isChipSelected("Head of R&D reporting", "Head of R&D")).toBe(true)
  })
})

describe("toggleChip — removing", () => {
  it("removes a selected chip and collapses the stranded `at`", () => {
    expect(toggleChip("VP Engineering at fintech", "fintech", "company")).toBe(
      "VP Engineering"
    )
  })

  it("removing the last company type leaves no trailing `at`", () => {
    const withCompany = toggleChip("VP Engineering", "fintech", "company")
    expect(withCompany).toBe("VP Engineering at fintech")
    expect(toggleChip(withCompany, "fintech", "company")).toBe("VP Engineering")
  })

  it("removes a country and collapses the stranded `in`", () => {
    expect(
      toggleChip("VP Engineering at fintech in Germany", "Germany", "country")
    ).toBe("VP Engineering at fintech")
  })

  it("removes the first company and does not strand `at ,`", () => {
    expect(
      toggleChip("VP Engineering at fintech, SaaS", "fintech", "company")
    ).toBe("VP Engineering at SaaS")
  })

  it("removes a middle company and collapses the doubled comma", () => {
    expect(
      toggleChip("VP Engineering at fintech, SaaS, edtech", "SaaS", "company")
    ).toBe("VP Engineering at fintech, edtech")
  })

  it("removes a chip with regex metacharacters literally", () => {
    // The role is removed literally; the `at fintech` clause is intact (its `at`
    // still has an operand, so it is not stranded).
    expect(toggleChip("Head of R&D at fintech", "Head of R&D", "role")).toBe(
      "at fintech"
    )
  })
})

describe("toggleChip — round trip", () => {
  it.each([
    ["VP Engineering", "fintech", "company"],
    ["VP Engineering at fintech", "Germany", "country"],
    ["", "CTO", "role"],
    ["VP Engineering at fintech", "SaaS", "company"],
  ] as const)(
    "toggling %s with %s twice returns the original",
    (query, chip, kind) => {
      const once = toggleChip(query, chip, kind)
      expect(toggleChip(once, chip, kind)).toBe(query)
    }
  )
})
