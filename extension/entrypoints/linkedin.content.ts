import { extractFromNode, type LeadCandidate } from "@/lib/extract"
import { scoreLead } from "@/lib/score"

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    const seen = new Set<string>()
    const queue: { node: Element; cand: LeadCandidate }[] = []
    let draining = false

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
    }

    function badgeColor(score: number): string {
      if (score >= 80) return "#15803d"
      if (score >= 50) return "#a16207"
      return "#6b7280"
    }

    function injectBadge(node: Element, score: number, reasons: string[]) {
      try {
        if (node.querySelector(":scope > .glint-badge")) return
        const b = document.createElement("span")
        b.className = "glint-badge"
        b.textContent = `Glint ${score}`
        b.title = reasons.join(" • ")
        b.setAttribute(
          "style",
          [
            "display:inline-block",
            "margin:4px 0",
            "padding:2px 8px",
            "border-radius:9999px",
            "font:600 11px/1.4 system-ui,sans-serif",
            "color:#fff",
            `background:${badgeColor(score)}`,
            "position:relative",
            "z-index:9999",
          ].join(";")
        )
        node.prepend(b)
      } catch {
        // never break LinkedIn's page
      }
    }

    async function drain() {
      if (draining) return
      draining = true
      while (queue.length) {
        const { node, cand } = queue.shift()!
        const result = await scoreLead(cand)
        if (result) injectBadge(node, result.match_score, result.match_reasons)
        await new Promise((r) => setTimeout(r, 400)) // rate-limit
      }
      draining = false
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
        queue.push({ node, cand })
      })
      if (queue.length) drain()
    }

    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(() => scan(document), 500)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    scan(document)
  },
})
