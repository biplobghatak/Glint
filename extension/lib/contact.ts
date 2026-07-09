/**
 * LinkedIn serves the contact-info modal standalone at this path, so enrichment
 * never has to click "More -> Contact info" and drive a modal state machine.
 *
 * UNVERIFIED against a live authenticated session. If this 302s to the profile,
 * extractContactInfo() finds nothing, the caller records "no public contact
 * info", and nothing breaks -- it just never finds an email. That is the
 * fail-soft posture every LinkedIn selector in this codebase takes.
 */
export function CONTACT_INFO_PATH(profilePath: string): string {
  return `${profilePath.replace(/\/+$/, "")}/overlay/contact-info/`
}

export function isContactInfoPath(pathname: string): boolean {
  return /^\/in\/[^/]+\/overlay\/contact-info\/?$/.test(pathname)
}

const PHONE_SHAPE = /^[+()\d][\d\s()+.-]{6,}$/

function firstNonEmpty(values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

/** Text of the list under a heading whose text matches `label`. */
function textUnderHeading(root: ParentNode, label: RegExp): string | null {
  const headings = Array.from(root.querySelectorAll("h3, h2, .pv-contact-info__header"))
  for (const h of headings) {
    if (!label.test(h.textContent ?? "")) continue
    const section = h.closest("section") ?? h.parentElement
    const value = section?.querySelector("li span, li a, li")?.textContent
    const t = value?.replace(/\s+/g, " ").trim()
    if (t) return t
  }
  return null
}

/**
 * Email and phone from the contact-info overlay. Both null is a legitimate,
 * common answer: an out-of-network member publishes neither. The caller must
 * still stamp `enriched_at`, or "we looked and found nothing" becomes
 * indistinguishable from "we never looked".
 */
export function extractContactInfo(root: ParentNode): {
  email: string | null
  phone: string | null
} {
  try {
    const mailto = root.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')
    const email = firstNonEmpty([
      mailto?.getAttribute("href")?.slice("mailto:".length),
      textUnderHeading(root, /e-?mail/i),
    ])

    const tel = root.querySelector<HTMLAnchorElement>('a[href^="tel:"]')
    const rawPhone = firstNonEmpty([
      tel?.getAttribute("href")?.slice("tel:".length),
      textUnderHeading(root, /phone/i),
    ])
    // A heading match can pick up junk; a phone that isn't phone-shaped is
    // worse than no phone, because the user will dial it.
    const phone = rawPhone && PHONE_SHAPE.test(rawPhone) ? rawPhone : null

    return { email: email && email.includes("@") ? email : null, phone }
  } catch {
    return { email: null, phone: null }
  }
}

export type ContactInfoResult = {
  /**
   * Whether the overlay was actually read. The whole point of this flag.
   *
   * `{email: null, phone: null}` is ambiguous: it is the correct answer for an
   * out-of-network member who publishes neither, AND what you get from a login
   * wall, a 302 to the profile, or a page whose contact section is rendered by
   * JavaScript the fetch never ran. Stamping enriched_at on the second case
   * would permanently record "no public contact info" for a lead nobody looked
   * at. So: `readable: false` means "ask again, properly", never "found none".
   */
  readable: boolean
  email: string | null
  phone: string | null
}

/**
 * Parse a contact-info overlay fetched as HTML, without opening a tab.
 *
 * DOMParser is unavailable in an MV3 service worker, so this necessarily runs in
 * a content script (which also makes the fetch same-origin, so the session
 * cookie rides along without any credential handling of our own).
 *
 * Readability is inferred, because LinkedIn will not tell us: any mailto/tel we
 * can see proves we read the overlay; failing that, a "Contact info" heading
 * proves the overlay rendered and simply held nothing.
 */
export function parseContactInfoHtml(html: string): ContactInfoResult {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html")
    const info = extractContactInfo(doc)
    if (info.email || info.phone) return { readable: true, ...info }

    const headings = Array.from(
      doc.querySelectorAll("h1, h2, h3, [class*='contact-info']")
    )
    const rendered = headings.some((el) => /contact\s*info/i.test(el.textContent ?? ""))
    return { readable: rendered, ...info }
  } catch {
    return { readable: false, email: null, phone: null }
  }
}
