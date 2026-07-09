export type LeadCandidate = {
  name: string | null
  headline: string | null
  company: string | null
  post_text: string | null
  linkedin_url: string | null
  source: "profile" | "post" | "search_result"
}

function text(el: Element | null): string | null {
  const t = el?.textContent?.replace(/\s+/g, " ").trim()
  return t && t.length > 0 ? t : null
}

function firstProfileLink(node: Element): string | null {
  const a = node.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
  if (!a) return null
  try {
    const u = new URL(a.href, location.origin)
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Structural search-result card discovery.
//
// LinkedIn's class names on people-search cards rotate; the known-selector
// fast path below is a best-effort guess that will eventually go stale again
// (as it already has once). Structural discovery falls back to something
// that doesn't depend on class names at all: every people-search result card
// contains at least one profile anchor (a[href*="/in/"]) — usually two
// (avatar + name) — and every anchor inside a single card resolves to the
// SAME profile. So for each profile anchor we climb ancestors as long as the
// ancestor still contains only that one profile's anchors; the last ancestor
// before a sibling card's profile would be swallowed in is the card.
// ---------------------------------------------------------------------------

const KNOWN_SEARCH_RESULT_SELECTORS =
  'li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'

// Containers we never want to treat as (part of) a result card: global chrome
// and the messaging overlay both contain /in/ profile links that have
// nothing to do with the search-results list.
const EXCLUDED_ANCESTOR_SELECTOR =
  'nav, header, footer, aside, .msg-overlay-list-bubble, .msg-overlay-conversation-bubble, [class*="msg-overlay"]'

function isInExcludedContainer(el: Element): boolean {
  return !!el.closest(EXCLUDED_ANCESTOR_SELECTOR)
}

function anchorHasMeaningfulText(a: HTMLAnchorElement): boolean {
  const t = a.textContent?.replace(/\s+/g, " ").trim() ?? ""
  return t.length > 0
}

function normalizeProfilePath(href: string): string | null {
  try {
    const u = new URL(href, location.origin)
    if (!u.pathname.includes("/in/")) return null
    let path = u.pathname
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1)
    return path
  } catch {
    return null
  }
}

/**
 * Returns the set of distinct profile paths reachable via a[href*="/in/"]
 * within `node` (including `node` itself if it's such an anchor's ancestor).
 */
function profilePathsWithin(node: Element): Set<string> {
  const profiles = new Set<string>()
  const anchors = node.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')
  anchors.forEach((a) => {
    const p = normalizeProfilePath(a.href)
    if (p) profiles.add(p)
  })
  return profiles
}

// Used by extractFromNode to recognize a card that structural discovery
// would also identify, even when called directly on a single node rather
// than via findSearchResultCards(). A node "is" a single-profile card when
// every /in/ anchor inside it points at the same profile.
function isStructuralSearchResultCard(node: Element): boolean {
  const profiles = profilePathsWithin(node)
  return profiles.size === 1
}

/**
 * Finds all people-search result cards under `root`.
 *
 * Fast path: LinkedIn's known (but rotting) class names / data attributes,
 * kept only when a hit actually looks like one person's card. Otherwise fall
 * through to structural discovery.
 */
export function findSearchResultCards(root: ParentNode): Element[] {
  // Trusting the fast path merely because it matched *something* is a trap: a
  // rotted selector can still hit a wrapper or an ad container holding no
  // profile link at all. Those give cards.length > 0 but extract to null for
  // every one, which reads as "found cards, couldn't score them" instead of
  // the truth, "these selectors are stale". Require exactly one profile.
  const fast = Array.from(
    root.querySelectorAll(KNOWN_SEARCH_RESULT_SELECTORS)
  ).filter((el) => profilePathsWithin(el).size === 1)
  if (fast.length > 0) return fast

  const anchors = Array.from(
    root.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')
  ).filter((a) => !isInExcludedContainer(a) && anchorHasMeaningfulText(a))

  const cardByProfile = new Map<string, Element>()

  for (const anchor of anchors) {
    const profile = normalizeProfilePath(anchor.href)
    if (!profile || cardByProfile.has(profile)) continue

    let candidate: Element = anchor
    let node: Element | null = anchor.parentElement
    while (node && (node as ParentNode) !== root) {
      const innerProfiles = profilePathsWithin(node)
      // Climbing further would either merge in a sibling card's profile, or
      // (size 0, shouldn't happen since `node` contains `anchor`) lose this
      // one — either way, stop and keep the previous candidate as the card.
      if (innerProfiles.size !== 1) break
      candidate = node
      node = node.parentElement
    }

    const candidateText = (candidate as HTMLElement).innerText?.trim() ?? ""
    if (candidateText.length < 10) continue // no meaningful content — skip

    cardByProfile.set(profile, candidate)
  }

  // Two profile anchors (avatar + name) can resolve to the very same card
  // element — dedupe by identity before returning.
  return Array.from(new Set(cardByProfile.values()))
}

// ---------------------------------------------------------------------------
// Resilient field extraction for search-result cards.
// ---------------------------------------------------------------------------

const BUTTON_LABELS = new Set([
  "connect",
  "message",
  "follow",
  "following",
  "pending",
  "view profile",
])

function isDegreeLine(line: string): boolean {
  return /^•?\s*(1st|2nd|3rd\+?)$/i.test(line.trim())
}

function isButtonLabelLine(line: string): boolean {
  return BUTTON_LABELS.has(line.trim().toLowerCase())
}

function looksLikeLocationLine(line: string): boolean {
  const l = line.trim()
  if (!l.includes(",")) return false
  if (/\bat\b|@|\|/i.test(l)) return false
  if (/\d/.test(l)) return false
  return true
}

// Strips LinkedIn noise that leaks into a raw name string: a trailing degree
// badge ("• 1st" / "• 2nd" / "• 3rd+"), "View X's profile" link text, and
// collapses whitespace.
function cleanExtractedName(raw: string): string {
  let s = raw
  s = s.replace(/view\s+.*?[’']s\s+profile/gi, " ")
  // No trailing \b here: with an optional trailing "+" (3rd\+?), \b right
  // after a consumed "+" sits between two non-word characters and never
  // matches, so the engine backtracks to NOT consuming the "+" — leaving a
  // stray "+" in the cleaned name (e.g. "Zenystra Labs +"). Anchoring on the
  // leading "•" is specific enough without a trailing boundary.
  s = s.replace(/•\s*(1st|2nd|3rd\+?)/gi, " ")
  s = s.replace(/\s+/g, " ").trim()
  return s
}

// Structural fallback for the name: the profile anchor's aria-hidden span
// (preferred, since LinkedIn duplicates the name in an sr-only span for
// accessibility) or the anchor's own text. Avatar-only anchors have no text
// and are skipped in favor of the name anchor.
function extractNameFromCard(node: Element): string | null {
  const anchors = Array.from(
    node.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')
  ).filter((a) => !isInExcludedContainer(a))
  for (const a of anchors) {
    const raw = text(a.querySelector('span[aria-hidden="true"]')) ?? text(a)
    if (!raw) continue
    const cleaned = cleanExtractedName(raw)
    if (cleaned) return cleaned
  }
  return null
}

// Structural fallback for the headline: the card's innerText, split on
// newlines, is a fair approximation of the visual line order. Find the line
// that starts with the (already-cleaned) name, then take the next
// non-empty line that isn't itself a degree badge, a location, or a button
// label.
function extractHeadlineFromCard(node: Element, name: string | null): string | null {
  if (!name) return null
  const innerText = (node as HTMLElement).innerText
  if (!innerText) return null
  const lines = innerText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const nameIdx = lines.findIndex((l) => l.startsWith(name))
  if (nameIdx === -1) return null
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (isDegreeLine(line) || isButtonLabelLine(line) || looksLikeLocationLine(line)) {
      continue
    }
    return line
  }
  return null
}

// Structural fallback for company: parsed out of the headline, the text
// after " at " or " @ ", cut at the first "|" (LinkedIn headlines often
// chain extra context after a pipe).
function extractCompanyFromHeadline(headline: string | null): string | null {
  if (!headline) return null
  const m = headline.match(/\s(?:at|@)\s+(.+)$/i)
  if (!m) return null
  let company = m[1]
  const pipeIdx = company.indexOf("|")
  if (pipeIdx !== -1) company = company.slice(0, pipeIdx)
  company = company.trim()
  return company.length > 0 ? company : null
}

// LinkedIn's DOM is unstable; every selector is best-effort and must fail soft.
export function extractFromNode(node: Element): LeadCandidate | null {
  try {
    // Feed post
    if (node.matches('div.feed-shared-update-v2, [data-urn*="urn:li:activity"]')) {
      const name = text(
        node.querySelector(
          ".update-components-actor__title span[aria-hidden='true']"
        ) ?? node.querySelector(".update-components-actor__title")
      )
      const headline = text(
        node.querySelector(".update-components-actor__description")
      )
      const post_text = text(
        node.querySelector(
          ".update-components-text, .feed-shared-update-v2__description"
        )
      )
      const linkedin_url = firstProfileLink(node)
      if (!name && !post_text) return null
      return {
        name,
        headline,
        company: null,
        post_text,
        linkedin_url,
        source: "post",
      }
    }

    // Search result / people card — try the known (fast-path) selectors
    // first, then fall back to structural extraction field-by-field.
    if (
      node.matches(KNOWN_SEARCH_RESULT_SELECTORS) ||
      isStructuralSearchResultCard(node)
    ) {
      let name = text(
        node.querySelector(
          ".entity-result__title-text a span[aria-hidden='true']"
        ) ?? node.querySelector(".entity-result__title-text a")
      )
      if (name) name = cleanExtractedName(name)
      if (!name) name = extractNameFromCard(node)

      let headline = text(node.querySelector(".entity-result__primary-subtitle"))
      if (!headline) headline = extractHeadlineFromCard(node, name)

      let company = text(node.querySelector(".entity-result__secondary-subtitle"))
      if (!company) company = extractCompanyFromHeadline(headline)

      const linkedin_url = firstProfileLink(node)
      if (!name) return null
      return {
        name,
        headline,
        company,
        post_text: null,
        linkedin_url,
        source: "search_result",
      }
    }

    return null
  } catch {
    return null
  }
}
