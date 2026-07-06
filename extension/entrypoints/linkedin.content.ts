import { extractFromNode, type LeadCandidate } from "@/lib/extract"

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    const seen = new Set<string>()

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
    }

    function scan(root: ParentNode) {
      const candidates = root.querySelectorAll(
        'div.feed-shared-update-v2, [data-urn*="urn:li:activity"], li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'
      )
      candidates.forEach((node) => {
        const cand = extractFromNode(node)
        if (!cand) return
        const key = keyOf(cand)
        if (seen.has(key)) return
        seen.add(key)
        // Day 4 replaces this with a score-lead call + inline badge.
        console.debug("[glint] lead candidate", cand)
      })
    }

    scan(document)

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n instanceof Element) scan(n)
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  },
})
