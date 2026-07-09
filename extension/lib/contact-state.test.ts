import { describe, expect, it } from "vitest"
import { contactState } from "./contact-state"

describe("contactState", () => {
  it("is not_looked_up when enriched_at is null, regardless of email/phone", () => {
    expect(
      contactState({ email: null, phone: null, enriched_at: null })
    ).toBe("not_looked_up")
  })

  it("is no_public_info when enriched but neither email nor phone is set", () => {
    expect(
      contactState({ email: null, phone: null, enriched_at: "2026-07-01T00:00:00Z" })
    ).toBe("no_public_info")
  })

  it("is has_info when enriched with both email and phone", () => {
    expect(
      contactState({
        email: "jane@acme.io",
        phone: "+1 415 555 0134",
        enriched_at: "2026-07-01T00:00:00Z",
      })
    ).toBe("has_info")
  })

  it("is has_info when enriched with only an email", () => {
    expect(
      contactState({
        email: "jane@acme.io",
        phone: null,
        enriched_at: "2026-07-01T00:00:00Z",
      })
    ).toBe("has_info")
  })

  it("is has_info when enriched with only a phone", () => {
    expect(
      contactState({
        email: null,
        phone: "+1 415 555 0134",
        enriched_at: "2026-07-01T00:00:00Z",
      })
    ).toBe("has_info")
  })
})
