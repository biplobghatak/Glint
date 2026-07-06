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

    // Search result / people card
    if (
      node.matches(
        'li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'
      )
    ) {
      const name = text(
        node.querySelector(
          ".entity-result__title-text a span[aria-hidden='true']"
        ) ?? node.querySelector(".entity-result__title-text a")
      )
      const headline = text(node.querySelector(".entity-result__primary-subtitle"))
      const company = text(node.querySelector(".entity-result__secondary-subtitle"))
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
