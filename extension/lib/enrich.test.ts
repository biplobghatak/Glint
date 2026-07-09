import { describe, expect, it } from "vitest"
import { profilePathFromUrl } from "./enrich"

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
