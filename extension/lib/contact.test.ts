import { describe, expect, it } from "vitest"
import {
  CONTACT_INFO_PATH,
  extractContactInfo,
  isContactInfoPath,
  parseContactInfoHtml,
} from "./contact"

function root(html: string): ParentNode {
  const el = document.createElement("div")
  el.innerHTML = html
  return el
}

describe("CONTACT_INFO_PATH", () => {
  it("builds the standalone overlay path", () => {
    expect(CONTACT_INFO_PATH("/in/jane-doe")).toBe("/in/jane-doe/overlay/contact-info/")
  })
  it("tolerates a trailing slash", () => {
    expect(CONTACT_INFO_PATH("/in/jane-doe/")).toBe("/in/jane-doe/overlay/contact-info/")
  })
})

describe("isContactInfoPath", () => {
  it.each([
    ["/in/jane/overlay/contact-info/", true],
    ["/in/jane/overlay/contact-info", true],
    ["/in/jane", false],
    ["/feed/", false],
  ])("%s -> %s", (path, expected) => {
    expect(isContactInfoPath(path)).toBe(expected)
  })
})

describe("extractContactInfo", () => {
  it("reads a mailto: address", () => {
    const r = root(`<section><a href="mailto:jane@acme.io">jane@acme.io</a></section>`)
    expect(extractContactInfo(r).email).toBe("jane@acme.io")
  })

  it("reads a tel: number", () => {
    const r = root(`<section><a href="tel:+493012345678">+49 30 1234 5678</a></section>`)
    expect(extractContactInfo(r).phone).toBe("+493012345678")
  })

  // The overlay renders a phone as plain text under a "Phone" heading at least
  // as often as it renders a tel: link.
  it("reads a phone from the labelled section when there is no tel: link", () => {
    const r = root(
      `<section><h3>Phone</h3><ul><li><span>+1 415 555 0134</span></li></ul></section>`
    )
    expect(extractContactInfo(r).phone).toBe("+1 415 555 0134")
  })

  // An out-of-network profile renders the modal with no email. That is a
  // legitimate answer -- "no public contact info" -- not a failure. The caller
  // still sets enriched_at.
  it("returns nulls for a modal with no contact details", () => {
    const r = root(`<section><h3>Websites</h3><a href="https://acme.io">acme.io</a></section>`)
    expect(extractContactInfo(r)).toEqual({ email: null, phone: null })
  })

  it("ignores a mailto: with no address", () => {
    expect(extractContactInfo(root(`<a href="mailto:">x</a>`)).email).toBeNull()
  })

  it("never throws on hostile markup", () => {
    expect(() => extractContactInfo(root(`<a href>`))).not.toThrow()
  })
})

describe("parseContactInfoHtml", () => {
  it("reads an email out of a mailto anchor", () => {
    const r = parseContactInfoHtml(
      `<h2>Contact info</h2><a href="mailto:jane@acme.com">jane@acme.com</a>`
    )
    expect(r).toEqual({ readable: true, email: "jane@acme.com", phone: null })
  })

  // The whole reason `readable` exists. Both of the next two cases extract
  // {email: null, phone: null}; only the first of them means "this member
  // publishes no contact info". Recording the second as such would permanently
  // stamp enriched_at on a lead nobody actually looked at.
  it("is readable when the overlay rendered but held nothing", () => {
    const r = parseContactInfoHtml(`<h2>Contact info</h2><section><ul></ul></section>`)
    expect(r).toEqual({ readable: true, email: null, phone: null })
  })

  it("is NOT readable when the overlay never rendered (login wall)", () => {
    const r = parseContactInfoHtml(`<h1>Sign in</h1><form id="login"></form>`)
    expect(r.readable).toBe(false)
    expect(r.email).toBeNull()
  })

  it("is not readable for empty or junk input", () => {
    expect(parseContactInfoHtml("").readable).toBe(false)
    expect(parseContactInfoHtml("<p>302</p>").readable).toBe(false)
  })

  it("still reads a phone when only a tel anchor is present", () => {
    const r = parseContactInfoHtml(`<a href="tel:+1 415 555 0100">call</a>`)
    expect(r).toEqual({ readable: true, email: null, phone: "+1 415 555 0100" })
  })
})
