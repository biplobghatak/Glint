import { browser } from "wxt/browser"
import { extractFromNode, type LeadCandidate } from "@/lib/extract"
import { scoreLead } from "@/lib/score"
import { getRunState, setRunState, clearRunState, type RunState } from "@/lib/run"
import type { RuntimeMessage, WhichTabMessage, WhichTabResponse } from "@/lib/messages"

const SEARCH_RESULT_SELECTOR =
  'li.reusable-search__result-container, div.entity-result, [data-view-name="search-entity-result"]'

// UNVERIFIED against live LinkedIn markup — best-effort guess from the plan.
// If this stops matching, clickNextPage() degrades gracefully to a scroll
// (see the fallback below), so a wrong selector never breaks the run, but a
// human should inspect the real "next page" button's aria-label/selector and
// update this single constant.
const NEXT_PAGE_SELECTOR = 'button[aria-label="Next"]:not([disabled])'

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((r) => setTimeout(r, ms))
}

function hasCommercialLimitBanner(): boolean {
  return /commercial use limit/i.test(document.body.innerText)
}

function clickNextPage(): boolean {
  const next = document.querySelector<HTMLButtonElement>(NEXT_PAGE_SELECTOR)
  if (!next) return false
  next.click()
  return true
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

function sendMessage(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

// Ask the background which tab this content script instance is running in,
// so it can be compared against RunState.tabId — a content script can't read
// its own tab id directly. This gates whether THIS tab is allowed to drive
// runAgentLoop() at all; see main() below.
async function requestMyTabId(): Promise<number | null> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "WHICH_TAB",
    } satisfies WhichTabMessage)) as WhichTabResponse | undefined
    return response?.tabId ?? null
  } catch {
    // On Firefox, background.ts registers no listeners at all (everything
    // is gated behind `BROWSER === "chrome"`), so this request has no
    // receiving end and the promise rejects ("Could not establish
    // connection"). Treat that as "this is not the run's tab" — runs can
    // never start on Firefox anyway (the side panel is Chrome-only), so
    // falling back to passive mode is correct, not a degraded state.
    return null
  }
}

async function stopRun(reason: string) {
  await clearRunState()
  sendMessage({ type: "STOPPED", reason })
}

function postProgress(leadCount: number, status: string) {
  sendMessage({ type: "PROGRESS", leadCount, status })
}

function isOverCap(state: RunState): "leads" | "time" | null {
  if (state.leadCount >= state.maxLeads) return "leads"
  const elapsedMinutes = (Date.now() - state.startedAt) / 60000
  if (elapsedMinutes >= state.maxMinutes) return "time"
  return null
}

async function runAgentLoop(myTabId: number) {
  const seen = new Set<string>()
  let staleRounds = 0
  // Tracks whether clickNextPage() has EVER successfully matched and clicked
  // a button during this run, so a wrong NEXT_PAGE_SELECTOR (silent failure)
  // can be told apart from genuinely exhausting the results — both currently
  // end the same way (3 stale rounds), but they must not report the same
  // stop reason. See the staleRounds >= 3 branch below.
  let paginationSucceededOnce = false
  let warnedAboutNextSelector = false

  while (true) {
    // Always re-read fresh state at the top of the outer loop — never trust
    // a snapshot carried across an await.
    const state = await getRunState()
    if (!state || !state.active) return
    // This tab is no longer (or never was) the run's own tab — e.g. the run
    // ended and a different run started elsewhere in the time since our last
    // check. Stop driving immediately, but do NOT call stopRun()/
    // clearRunState(): that would tear down a run this tab doesn't own. Just
    // stand down silently; the owning tab's loop is responsible for its own
    // stop conditions.
    if (state.tabId !== myTabId) return

    const cap = isOverCap(state)
    if (cap === "leads") {
      await stopRun("Reached lead limit")
      return
    }
    if (cap === "time") {
      await stopRun("Reached time limit")
      return
    }
    if (document.hidden) {
      await randomDelay(2000, 4000)
      continue
    }
    if (hasCommercialLimitBanner()) {
      await stopRun("LinkedIn search limit reached — try again later")
      return
    }

    const cards = Array.from(document.querySelectorAll(SEARCH_RESULT_SELECTOR))
    let scoredThisBatch = 0

    for (const node of cards) {
      // Re-check stop conditions fresh before every card, not just once per
      // batch. The inner loop can run for many seconds (scoreLead network
      // call + pacing delay per card), so Stop and the caps must be able to
      // interrupt mid-batch, not only at the top of the outer loop.
      const beforeCard = await getRunState()
      if (!beforeCard || !beforeCard.active) return
      if (beforeCard.tabId !== myTabId) return
      const capBeforeCard = isOverCap(beforeCard)
      if (capBeforeCard === "leads") {
        await stopRun("Reached lead limit")
        return
      }
      if (capBeforeCard === "time") {
        await stopRun("Reached time limit")
        return
      }

      const cand = extractFromNode(node)
      if (!cand) continue
      const key = cand.linkedin_url ?? `${cand.name ?? ""}|${cand.company ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)

      const result = await scoreLead(cand)
      if (result) {
        // scoreLead is a network call — a Stop click can land while it's in
        // flight. Re-read the run state fresh right here, immediately before
        // the persisted mutation, and bail without writing anything if the
        // run was cleared or deactivated in the meantime. Writing back a
        // pre-await snapshot here is exactly what would resurrect a cleared
        // run (glint_run reappearing with active: true after Stop).
        const fresh = await getRunState()
        if (!fresh || !fresh.active) return
        if (fresh.tabId !== myTabId) return
        injectBadge(node, result.match_score, result.match_reasons)
        scoredThisBatch++
        fresh.leadCount++
        await setRunState(fresh)
        postProgress(fresh.leadCount, `Scored ${cand.name ?? "a lead"}`)

        // Enforce the lead cap the instant it's crossed, rather than waiting
        // for the next card's top-of-loop check.
        if (fresh.leadCount >= fresh.maxLeads) {
          await stopRun("Reached lead limit")
          return
        }
      }
      await randomDelay(400, 900)
    }

    if (scoredThisBatch === 0) {
      staleRounds++
      if (staleRounds >= 3) {
        // Same symptom (3 stale rounds), two very different causes: either
        // we truly reached the end of results, or NEXT_PAGE_SELECTOR never
        // matched anything and we've been stuck on page 1 the whole time.
        // Report them differently so this isn't indistinguishable from a
        // successful complete run.
        await stopRun(
          paginationSucceededOnce
            ? "No more new results found"
            : "Couldn't find LinkedIn's next-page button — stopped after the first page of results."
        )
        return
      }
    } else {
      staleRounds = 0
    }

    if (clickNextPage()) {
      paginationSucceededOnce = true
    } else {
      if (!warnedAboutNextSelector) {
        warnedAboutNextSelector = true
        console.warn(
          `Glint: NEXT_PAGE_SELECTOR ('${NEXT_PAGE_SELECTOR}') did not match a "Next" button — falling back to scroll. LinkedIn's markup may have changed.`
        )
      }
      window.scrollBy(0, window.innerHeight * 0.8)
    }
    await randomDelay(3000, 8000)
  }
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    let agentActive = false
    let passiveStarted = false
    // True for the whole lifetime of runAgentLoop() on THIS tab, from the
    // moment it's launched until its promise settles. Used to stop the
    // browser.storage.onChanged listener from re-arming passive mode while
    // the agent loop is still unwinding (e.g. mid scoreLead()) after Stop —
    // otherwise both modes can briefly score the same cards. See Fix 3.
    let loopRunning = false

    // --- existing passive scan (unchanged behavior, gated off during a run) ---
    const seen = new Set<string>()
    const queue: { node: Element; cand: LeadCandidate }[] = []
    let draining = false

    function keyOf(c: LeadCandidate): string {
      return c.linkedin_url ?? `${c.name ?? ""}|${c.post_text?.slice(0, 40) ?? ""}`
    }

    async function drain() {
      if (draining) return
      draining = true
      while (queue.length) {
        const { node, cand } = queue.shift()!
        const result = await scoreLead(cand)
        if (result) injectBadge(node, result.match_score, result.match_reasons)
        await new Promise((r) => setTimeout(r, 400))
      }
      draining = false
    }

    function scan(root: ParentNode) {
      if (agentActive) return
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

    // Only ever start the passive observer/scan while no run is active. This
    // is called both at startup (if there's no run) and whenever a run ends
    // later (agent loop stops itself, or the user clicks Stop) so passive
    // mode resumes.
    function startPassive() {
      if (passiveStarted) return
      passiveStarted = true
      observer.observe(document.body, { childList: true, subtree: true })
      scan(document)
    }

    // --- agent mode ---
    // Keep this listener registered unconditionally so agentActive flips
    // correctly whenever a run starts or stops later, in either direction.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.glint_run) return
      const newState = changes.glint_run.newValue as RunState | undefined
      agentActive = !!newState?.active
      // Don't re-arm passive mode here if this tab's own agent loop is still
      // unwinding (e.g. finishing a scoreLead() call after Stop cleared
      // glint_run). runAgentLoop()'s .finally() below is the one that calls
      // startPassive() once the loop has actually exited, sequencing the
      // handoff instead of racing it.
      if (!agentActive && !loopRunning) startPassive()
    })

    // Resolve BOTH this tab's own id and the run state BEFORE doing any
    // passive scanning/observing or deciding to drive the agent loop. On a
    // search-results page the background just navigated to for a new run,
    // scanning synchronously at startup (before this resolves) would score
    // cards passively right before the agent gate closes — the exact
    // double-scoring the run mode exists to prevent. And critically: only
    // drive runAgentLoop() when this tab IS the run's own tab (state.tabId
    // matches). Any other LinkedIn tab that loads or navigates during a run
    // (e.g. a lead's profile opened in a new tab) must fall back to passive
    // mode instead of independently scanning/paginating/mutating glint_run.
    Promise.all([requestMyTabId(), getRunState()]).then(([myTabId, state]) => {
      agentActive = !!state?.active
      if (agentActive && state && myTabId !== null && state.tabId === myTabId) {
        loopRunning = true
        runAgentLoop(myTabId).finally(() => {
          loopRunning = false
          startPassive()
        })
      } else {
        startPassive()
      }
    })
  },
})
