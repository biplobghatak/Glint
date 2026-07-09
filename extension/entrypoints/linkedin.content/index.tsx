import { browser } from "wxt/browser"
import { extractFromNode, findSearchResultCards, type LeadCandidate } from "@/lib/extract"
import { scoreLead } from "@/lib/score"
import { getRunState, setRunState, clearRunState, type RunState } from "@/lib/run"
import type { RuntimeMessage, WhichTabMessage, WhichTabResponse } from "@/lib/messages"
import "./style.css"

const FEED_POST_SELECTOR = 'div.feed-shared-update-v2, [data-urn*="urn:li:activity"]'

// The custom element createShadowRootUi() mounts the draft card into. Named
// here rather than inlined because isGlintNode() has to recognize it.
const DRAFT_CARD_TAG = "glint-draft-card"

// UNVERIFIED against live LinkedIn markup — best-effort guesses, tried in
// order. The first one that matches a non-disabled button wins. If none of
// these match, clickNextPage() degrades gracefully to a scroll (see the
// fallback below), so a wrong selector never breaks the run, but a human
// should inspect the real "next page" button's aria-label/selector and
// update this list. Do not add more guesses beyond these three.
const NEXT_PAGE_SELECTORS = [
  'button[aria-label="Next"]:not([disabled])',
  'button[aria-label*="Next"]:not([disabled])',
  ".artdeco-pagination__button--next:not([disabled])",
] as const

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((r) => setTimeout(r, ms))
}

function hasCommercialLimitBanner(): boolean {
  return /commercial use limit/i.test(document.body.innerText)
}

// LinkedIn renders pagination in a footer below the whole results list, and
// only mounts it once that region has been reached. Looking for the button
// from the top of the page finds nothing, so bring the bottom into view first
// and give the page a beat to mount it.
async function scrollToPagination(): Promise<void> {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
  await randomDelay(700, 1400)
}

function clickNextPage(): boolean {
  for (const selector of NEXT_PAGE_SELECTORS) {
    const next = document.querySelector<HTMLButtonElement>(selector)
    if (next) {
      // A button scrolled out of view can still be clicked, but centering it
      // matches what a person would do and avoids overlay intercepts.
      next.scrollIntoView({ block: "center" })
      next.click()
      return true
    }
  }
  return false
}

// Badges are Glint's own nodes, injected into LinkedIn's DOM. The
// MutationObserver below watches document.body with subtree:true, so every
// badge we prepend re-triggers it, and the scan it schedules prepends more
// badges. Without this the observer feeds itself.
// Every element Glint injects into LinkedIn's document. The MutationObserver
// below watches document.body with subtree:true, so each of these re-triggers
// the scan that injects them. Without this guard that is a feedback loop —
// inject, observe, scan, inject — running on someone else's infinite-scroll
// feed.
//
// ANY new injected host must be added here in the same commit that introduces
// it. Today: score badges, and the draft-opener card's shadow host.
function isGlintNode(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return (
    node.classList.contains("glint-badge") ||
    node.tagName.toLowerCase() === DRAFT_CARD_TAG ||
    node.closest(`.glint-badge, ${DRAFT_CARD_TAG}`) !== null
  )
}

function badgeColor(score: number): string {
  if (score >= 80) return "#15803d"
  if (score >= 50) return "#a16207"
  return "#6b7280"
}

// A lead scoring below the user's threshold is still scored, still stored, and
// still badged — muted, not hidden. No badge must always mean "Glint hasn't
// scored this card", never "Glint scored it low": absence of feedback is
// indistinguishable from a broken extension, and the user would have no way to
// tell a filtered-out lead from a crashed content script.
function injectBadge(
  node: Element,
  score: number,
  reasons: string[],
  minScore: number
) {
  try {
    if (node.querySelector(":scope > .glint-badge")) return
    const belowThreshold = score < minScore
    const b = document.createElement("span")
    b.className = "glint-badge"
    b.textContent = `Glint ${score}`
    b.title = belowThreshold
      ? `Below your threshold of ${minScore} • ${reasons.join(" • ")}`
      : reasons.join(" • ")
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
        // Muted, not absent. Opacity is the whole difference between "we looked
        // and this one is weak" and "we never looked".
        ...(belowThreshold ? ["opacity:0.45"] : []),
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
  // Tracks whether findSearchResultCards() has EVER found a single card
  // during this run (found, not necessarily scored) — distinct from
  // paginationSucceededOnce. Without this, "no cards ever matched" (the
  // selectors are stale) and "cards matched but pagination never worked"
  // both end in the same 3-stale-rounds stop, and would be reported with
  // the same (wrong, for the first case) message. See the staleRounds >= 3
  // branch below for the precedence this drives.
  let everFoundCard = false
  let warnedAboutNoCards = false

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

    const cards = findSearchResultCards(document)
    let scoredThisBatch = 0
    let extractedThisBatch = 0
    console.debug("Glint: batch — cards found:", cards.length, "url:", location.pathname)

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
      extractedThisBatch++
      everFoundCard = true
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
        injectBadge(node, result.match_score, result.match_reasons, result.min_score)
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

    // Containers were discovered but every one of them extracted to null.
    // That means discovery is matching the wrong elements (a wrapper, an ad
    // slot) rather than person cards. Dump one so the markup can be read from
    // the page console instead of guessed at.
    if (cards.length > 0 && extractedThisBatch === 0 && !warnedAboutNoCards) {
      warnedAboutNoCards = true
      const sample = cards[0] as HTMLElement
      console.warn(
        "Glint: findSearchResultCards() matched",
        cards.length,
        "element(s) but extractFromNode() returned null for all of them.",
        "\nFirst match tag/class:",
        sample.tagName,
        sample.className,
        "\nProfile links inside it:",
        sample.querySelectorAll('a[href*="/in/"]').length,
        "\nOuter HTML (truncated):",
        sample.outerHTML.slice(0, 800)
      )
    }

    if (scoredThisBatch === 0) {
      staleRounds++
      if (staleRounds >= 3) {
        // Same symptom (3 stale rounds), three very different causes.
        // Precedence matters: "no cards at all" must be reported before
        // "no next-page button", since a run that never found a card also
        // never had a reason to paginate — reporting the pagination
        // message in that case would point the reader at the wrong file.
        let reason: string
        if (!everFoundCard) {
          if (!warnedAboutNoCards) {
            warnedAboutNoCards = true
            console.warn(
              "Glint: findSearchResultCards() never found a single result card on this page — check its known selectors and structural discovery against the current LinkedIn markup."
            )
          }
          reason =
            "Couldn't find LinkedIn's result cards — the page layout may have changed."
        } else if (!paginationSucceededOnce) {
          reason =
            "Couldn't find LinkedIn's next-page button — stopped after the first page of results."
        } else {
          reason = "No more new results found"
        }
        await stopRun(reason)
        return
      }
    } else {
      staleRounds = 0
    }

    // Reach the footer before looking for the pager — it isn't in the DOM
    // until the bottom of the results list has been scrolled into view.
    await scrollToPagination()

    if (clickNextPage()) {
      paginationSucceededOnce = true
    } else {
      if (!warnedAboutNextSelector) {
        warnedAboutNextSelector = true
        const buttons = Array.from(document.querySelectorAll("button"))
          .filter((b) =>
            /next|page/i.test((b.getAttribute("aria-label") ?? "") + b.textContent)
          )
          .map((b) => ({
            aria: b.getAttribute("aria-label"),
            cls: b.className,
            txt: b.textContent?.trim().slice(0, 24),
          }))
        console.warn(
          `Glint: none of NEXT_PAGE_SELECTORS (${NEXT_PAGE_SELECTORS.map((s) => `'${s}'`).join(", ")}) matched a "Next" button — falling back to scroll. Buttons on this page that look page-related:`,
          buttons
        )
      }
      window.scrollBy(0, window.innerHeight * 0.8)
    }
    await randomDelay(3000, 8000)
  }
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  // Required by createShadowRootUi: hands style.css to the draft card's shadow
  // root instead of injecting it into LinkedIn's document.
  cssInjectionMode: "ui",
  main(ctx) {
    // An unpacked extension never auto-updates — Chrome keeps running whatever
    // was loaded last. Print the build stamp so a stale extension announces
    // itself instead of masquerading as a code bug.
    console.info(`Glint: content script active (build ${__GLINT_BUILD__})`)

    let agentActive = false
    let observerAttached = false
    // True for the whole lifetime of runAgentLoop() on THIS tab, from the
    // moment it's launched until its promise settles. Used to stop the
    // browser.storage.onChanged listener from re-arming passive mode while
    // the agent loop is still unwinding (e.g. mid scoreLead()) after Stop —
    // otherwise both modes can briefly score the same cards. See Fix 3.
    let loopRunning = false

    // agentActive must mean "an agent loop is driving THIS tab", not "some
    // run is active somewhere" — otherwise a run on tab A silently disables
    // passive badging on every other LinkedIn tab for the run's whole
    // duration. That requires knowing this tab's own id, which is resolved
    // asynchronously (requestMyTabId(), below) — but browser.storage.onChanged
    // is registered before that resolves. myTabId/tabIdResolved distinguish
    // "not yet known" (tabIdResolved: false) from "known and null" (Firefox,
    // or a WHICH_TAB request that failed) — collapsing those would either
    // wrongly gate a real run's own tab off, or wrongly treat an unresolved
    // tab id as a match. While unresolved, agentActive is forced false (never
    // "not my run" mis-set as true) and re-evaluated the instant myTabId
    // resolves, using whichever run state is freshest at that point.
    let myTabId: number | null = null
    let tabIdResolved = false
    // Tracks the latest glint_run value observed via storage.onChanged, so
    // that a change arriving *before* myTabId resolves isn't lost — it's
    // replayed against the now-known myTabId as soon as resolution completes.
    // Distinct from "undefined" meaning "no change observed yet": a change
    // event legitimately carries newValue === undefined when the run was
    // cleared, so a separate boolean (not `latestRunState !== undefined`)
    // marks whether a change was observed at all.
    let sawStorageChange = false
    let latestRunState: RunState | undefined

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
        if (result) {
          injectBadge(node, result.match_score, result.match_reasons, result.min_score)
        }
        await new Promise((r) => setTimeout(r, 400))
      }
      draining = false
    }

    function scan(root: ParentNode) {
      if (agentActive) return
      const candidates: Element[] = [
        ...Array.from(root.querySelectorAll(FEED_POST_SELECTOR)),
        ...findSearchResultCards(root),
      ]
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
    const observer = new MutationObserver((mutations) => {
      // Ignore mutations we caused ourselves. Badging a card is a childList
      // mutation on that card, which would schedule a scan, which badges more
      // cards. Removals are never ours, so they always count.
      const meaningful = mutations.some((m) => {
        if (isGlintNode(m.target)) return false
        if (m.addedNodes.length === 0) return true
        return !Array.from(m.addedNodes).every(isGlintNode)
      })
      if (!meaningful) return
      clearTimeout(debounce)
      debounce = setTimeout(() => scan(document), 500)
    })

    // Only ever start the passive observer/scan while no run is active. This
    // is called both at startup (if there's no run) and whenever a run ends
    // later (agent loop stops itself, or the user clicks Stop) so passive
    // mode resumes.
    // Attaching the observer must happen exactly once; scanning must happen
    // every time a run ends. Guarding both with one flag conflated them: a
    // tab that isn't the run's own calls startPassive() at startup purely to
    // attach the observer, scan() no-ops because agentActive is true, and the
    // flag is spent — so when the run ends the re-arm short-circuits and that
    // tab never badges again until some unrelated DOM mutation happens to
    // retrigger the observer.
    function startPassive() {
      if (!observerAttached) {
        observerAttached = true
        observer.observe(document.body, { childList: true, subtree: true })
      }
      // scan() is itself gated on agentActive and deduped by `seen`, so
      // calling it on every transition is safe and idempotent.
      scan(document)
    }

    // Computes "is an agent loop driving THIS tab" from a RunState snapshot.
    // Returns false unconditionally until myTabId has resolved — an unknown
    // tab id must never be treated as a match.
    function computeAgentActive(state: RunState | undefined | null): boolean {
      if (!tabIdResolved) return false
      return !!state?.active && myTabId !== null && state.tabId === myTabId
    }

    // --- agent mode ---
    // Keep this listener registered unconditionally so agentActive flips
    // correctly whenever a run starts or stops later, in either direction.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.glint_run) return
      const newState = changes.glint_run.newValue as RunState | undefined
      sawStorageChange = true
      latestRunState = newState
      agentActive = computeAgentActive(newState)
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
    Promise.all([requestMyTabId(), getRunState()]).then(([resolvedTabId, state]) => {
      myTabId = resolvedTabId
      tabIdResolved = true
      // A storage.onChanged event may have arrived while myTabId was still
      // resolving — that's the freshest known state and must win over the
      // getRunState() snapshot taken back when this Promise.all was kicked
      // off, which could already be stale by the time we get here.
      const effectiveState = sawStorageChange ? latestRunState : (state ?? undefined)
      agentActive = computeAgentActive(effectiveState)
      if (agentActive && myTabId !== null) {
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
