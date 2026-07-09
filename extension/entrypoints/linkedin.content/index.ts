import { browser } from "wxt/browser"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { extractFromNode, findSearchResultCards, type LeadCandidate } from "@/lib/extract"
import { scoreLead, InvalidFolderError } from "@/lib/score"
import { getRunState, setRunState, clearRunState, type RunState } from "@/lib/run"
import { sendRuntimeMessage, type RuntimeMessage, type WhichTabMessage, type WhichTabResponse, type EnrichMessage, type EnrichResponse } from "@/lib/messages"
import { consumeDraft } from "@/lib/draft"
import { buildSearchUrl } from "@/lib/query"
import { nextAction } from "@/lib/agent-step"
import { isContactInfoPath, extractContactInfo, CONTACT_INFO_PATH } from "@/lib/contact"
import { profilePathFromUrl, nextEnrichStep } from "@/lib/enrich"
import { renderHud, HUD_TAG, type HudHandle } from "@/lib/hud"
import { formatScore } from "@/lib/format"
import { renderDraftCard } from "./draft-card"
import "./style.css"

const FEED_POST_SELECTOR = 'div.feed-shared-update-v2, [data-urn*="urn:li:activity"]'

// The custom element createShadowRootUi() mounts the draft card into. Named
// here rather than inlined because isGlintNode() has to recognize it.
const DRAFT_CARD_TAG = "glint-draft-card"

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((r) => setTimeout(r, ms))
}

function hasCommercialLimitBanner(): boolean {
  return /commercial use limit/i.test(document.body.innerText)
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
    node.closest(".glint-badge") !== null ||
    node.tagName.toLowerCase() === DRAFT_CARD_TAG ||
    node.tagName.toLowerCase() === HUD_TAG ||
    node.closest(HUD_TAG) !== null ||
    node.closest(DRAFT_CARD_TAG) !== null
  )
}

function badgeColor(score: number): string {
  if (score >= 80) return "#15803d"
  if (score >= 50) return "#a16207"
  return "#6b7280"
}

// A lead scoring below the user's threshold is still scored and still badged —
// muted, not hidden — but NOT stored. No badge must always mean "Glint hasn't
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
    b.textContent = `Glint ${formatScore(score)}`
    b.title = belowThreshold
      ? `Below your threshold of ${formatScore(minScore)} • ${reasons.join(" • ")}`
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
  sendRuntimeMessage(message)
}

// Ask the background which tab this content script instance is running in,
// so it can be compared against RunState.tabId — a content script can't read
// its own tab id directly. This gates whether THIS tab is allowed to drive
// runPageStep() at all; see main() below.
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

// Runs ONLY on a contact-info overlay tab (see the gate in main). Reports what
// extractContactInfo finds to the background, which correlates it to the pending
// lookup by this tab's id. The overlay is usually in the initial HTML, but a
// slow render must not be reported as "no contact info" — so poll briefly,
// resolving the instant anything is found, and otherwise report nulls well
// inside the background's 10s cap (both null is a legitimate answer the caller
// still stamps enriched_at for). Fire-and-forget: no response is awaited.
async function reportContactInfo(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const info = extractContactInfo(document)
    if (info.email || info.phone) {
      sendRuntimeMessage({ type: "CONTACT_INFO", email: info.email, phone: info.phone })
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  sendRuntimeMessage({ type: "CONTACT_INFO", email: null, phone: null })
}

const SCROLL_SETTLE_MS = 350

/** Give a smooth scroll time to land before we start scoring what it revealed. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS))
}

const SCANNING_CLASS = "glint-scanning"

// Tracks whether findSearchResultCards() has EVER matched a single card during
// this run. Module scope so the warning fires at most once across the many
// page-steps a run makes. "The selectors are stale, no card ever matched" is
// the one failure this stateless design cannot rule out, so it keeps its own
// message.
let warnedAboutNoCards = false

/**
 * Scans exactly one results page, then hands the decision back to nextAction().
 *
 * Stateless by construction: everything it remembers lives in RunState, so a
 * navigation between pages costs nothing. The old loop kept `seen` in a local
 * variable, which is why pagination had to be a button click rather than a
 * real navigation -- and why it never worked.
 */
async function runPageStep(myTabId: number, hud: HudHandle) {
  const initial = await getRunState()
  if (!initial || !initial.active || initial.tabId !== myTabId) return

  hud.update({
    leadCount: initial.leadCount,
    page: initial.page,
    maxPages: initial.maxPages,
    status: "Reading results…",
  })

  const seen = new Set(initial.seen)
  let everFoundCard = false

  // Preserved from the old loop, and load-bearing for different reasons.
  //
  // A smooth scroll does not animate in a background tab, so a run in a tab
  // the user cannot see would score the whole page instantly and invisibly --
  // defeating the HUD. Wait for the tab to come back instead.
  while (document.hidden) {
    const s = await getRunState()
    if (!s || !s.active || s.tabId !== myTabId) return
    await randomDelay(2000, 4000)
  }

  // LinkedIn cuts off search for free accounts that browse too much. Scoring
  // an empty results page would otherwise stop the run with "couldn't find
  // result cards", pointing the reader at extract.ts instead of the truth.
  if (hasCommercialLimitBanner()) {
    await stopRun("LinkedIn search limit reached — try again later")
    return
  }

  const cards = findSearchResultCards(document)
  console.debug("Glint: page", initial.page, "cards found:", cards.length)

  for (const node of cards) {
    // Re-read fresh before every card. The inner loop runs for many seconds
    // (a scoreLead round-trip plus pacing per card), so Stop and the caps
    // must interrupt mid-page, not only between pages.
    const before = await getRunState()
    if (!before || !before.active || before.tabId !== myTabId) return
    const decision = nextAction(before, Date.now())
    if (decision.kind === "stop") {
      await stopRun(decision.reason)
      return
    }

    const cand = extractFromNode(node)
    if (!cand) continue
    everFoundCard = true

    const key = cand.linkedin_url ?? `${cand.name ?? ""}|${cand.company ?? ""}`
    if (seen.has(key)) continue

    // The animation. This is the whole reason a person can tell the extension
    // is running: previously the only scroll in this file fired once, at the
    // end of a page, after every card had already been scored.
    node.scrollIntoView({ behavior: "smooth", block: "center" })
    node.classList.add(SCANNING_CLASS)
    await settle()
    hud.update({ status: `Scoring ${cand.name ?? "a lead"}…` })

    let result: Awaited<ReturnType<typeof scoreLead>>
    try {
      result = await scoreLead(cand, initial.folderId)
    } catch (err) {
      node.classList.remove(SCANNING_CLASS)
      if (err instanceof InvalidFolderError) {
        await stopRun("That folder was deleted. Pick another and start again.")
        return
      }
      throw err
    }

    node.classList.remove(SCANNING_CLASS)

    // scoreLead is a network call; a Stop click can land while it is in
    // flight. Re-read immediately before the persisted mutation and bail
    // without writing. Writing back a pre-await snapshot here is exactly what
    // would resurrect a cleared run.
    const fresh = await getRunState()
    if (!fresh || !fresh.active || fresh.tabId !== myTabId) return

    seen.add(key)
    fresh.seen = Array.from(seen)

    if (result) {
      injectBadge(node, result.match_score, result.match_reasons, result.min_score)
      // Only rows this call actually wrote. `stored` is also true for a dedupe
      // hit (the row already existed), and a re-encountered lead must not count
      // toward a cap that exists to bound NEW work — so gate on `inserted`, not
      // `stored`. A card badged muted was scored and discarded; counting either
      // would inflate the total and trip the cap early.
      if (result.inserted) {
        fresh.leadCount++
        // Queue for a contact-info visit — but ONLY on a fresh insert. A
        // sub-threshold lead was never stored and has no lead_id; a dedupe hit
        // (stored:true, inserted:false) already exists and is not re-enriched by
        // this run. lead_id rides on the fresh-insert response; profilePathFromUrl
        // returns null for a lead with no usable /in/ URL, which we simply skip.
        const profilePath = profilePathFromUrl(cand.linkedin_url)
        if (result.lead_id && profilePath) {
          fresh.enrichQueue = [
            ...fresh.enrichQueue,
            { leadId: result.lead_id, profilePath },
          ]
        }
      }
    }
    await setRunState(fresh)

    if (result?.inserted) {
      postProgress(fresh.leadCount, `Scored ${cand.name ?? "a lead"}`)
      hud.update({ leadCount: fresh.leadCount })
    }

    await randomDelay(400, 900)
  }

  if (!everFoundCard) {
    if (!warnedAboutNoCards) {
      warnedAboutNoCards = true
      console.warn(
        "Glint: findSearchResultCards() never found a result card on this page — check its selectors and structural discovery against the current LinkedIn markup."
      )
    }
    await stopRun(
      initial.page === 1
        ? "Couldn't find LinkedIn's result cards — the page layout may have changed."
        : `LinkedIn returned no results for page ${initial.page}`
    )
    return
  }

  // The page is scored. Before paginating, visit each STORED lead's contact-info
  // overlay in a background tab and enrich it — serially, announced, fail-soft.
  const scanned = await getRunState()
  if (!scanned || !scanned.active || scanned.tabId !== myTabId) return
  scanned.phase = "enriching"
  await setRunState(scanned)
  await runEnrichment(myTabId, hud)

  // The page is done. nextAction decides whether another one follows. Enrichment
  // is best-effort and may have stopped the run (Stop, time cap) — re-read and
  // bail if so. The queue is emptied here so the next page starts clean.
  const done = await getRunState()
  if (!done || !done.active || done.tabId !== myTabId) return
  done.phase = "paginating"
  done.enrichQueue = []
  await setRunState(done)

  const decision = nextAction(done, Date.now())
  if (decision.kind === "stop") {
    await stopRun(decision.reason)
    return
  }
  if (decision.kind === "navigate") {
    hud.update({ status: `Opening page ${decision.page}…` })
    const next: RunState = {
      ...done,
      page: decision.page,
      phase: "scanning",
    }
    await setRunState(next)
    // The background owns tab navigation -- it already does for startRun, and
    // reconcileRunState() watches chrome.tabs.onUpdated to notice a run tab
    // leaving LinkedIn. Two owners would make that reconciliation lie.
    sendMessage({ type: "NAVIGATE", url: buildSearchUrl(done.parsed, decision.page) })
  }
}

// Asks the background to run one contact-info lookup and awaits its completion.
// Awaiting the response is what serialises the pass: the background opens exactly
// one background tab, enriches, closes it, and only then replies — so the next
// lookup can't start until this one is fully done. A rejection (service worker
// gone, channel torn down) is the caller's problem to swallow; a failed lookup
// must never stop a run.
async function requestEnrich(leadId: string, url: string): Promise<void> {
  ;(await chrome.runtime.sendMessage({
    type: "ENRICH",
    leadId,
    url,
  } satisfies EnrichMessage)) as EnrichResponse | undefined
}

// Visits every lead stored on this page, in series, and enriches it with the
// email/phone from its contact-info overlay. Announced in the HUD; never
// parallel; never fatal. State is re-read each step so Stop and the time cap
// interrupt between leads — the lead cap deliberately does not (see nextEnrichStep).
async function runEnrichment(myTabId: number, hud: HudHandle): Promise<void> {
  let index = 0
  for (;;) {
    const state = await getRunState()
    if (!state || !state.active || state.tabId !== myTabId) return
    const step = nextEnrichStep(state, index, Date.now())
    if (step.kind === "done") return
    if (step.kind === "stop") {
      await stopRun(step.reason)
      return
    }
    hud.update({ status: step.label })
    const url = `${location.origin}${CONTACT_INFO_PATH(step.profilePath)}`
    try {
      await requestEnrich(step.leadId, url)
    } catch (err) {
      // A failed lookup must never stop a run: swallow and move on. The
      // background enriches with nulls on its own 10s timeout, so enriched_at is
      // still stamped in the ordinary failure cases.
      console.debug("Glint: enrich request failed", err)
    }
    index++
    // Pace like the card loop — one background tab at a time, never a burst.
    await randomDelay(400, 900)
  }
}

// Mounts the draft-opener card, if the panel left a draft for THIS profile.
//
// The panel wrote it to chrome.storage.local and then opened this tab, so this
// is the far side of that handoff. consumeDraft() is single-use and TTL-bounded:
// a draft for a tab the user closed before it loaded must not ambush them on the
// next profile they open.
async function mountDraftCard(ctx: ContentScriptContext): Promise<void> {
  if (!location.pathname.startsWith("/in/")) return

  const draft = await consumeDraft(location.pathname)
  if (!draft) return

  const ui = await createShadowRootUi<() => void>(ctx, {
    name: DRAFT_CARD_TAG,
    position: "overlay",
    anchor: "body",
    onMount: (container) => renderDraftCard(container, draft, () => ui.remove()),
    // renderDraftCard returns its own teardown (it polls for LinkedIn's
    // composer); dropping it here would leak an interval per dismissed card.
    onRemove: (teardown) => teardown?.(),
  })
  ui.mount()
}

// Mirrors mountDraftCard(). `position: "overlay"` + `anchor: "body"` puts the
// host element outside LinkedIn's layout; the card positions itself fixed.
async function mountHud(
  ctx: ContentScriptContext,
  onStop: () => void
): Promise<{ hud: HudHandle; remove: () => void }> {
  const ui = await createShadowRootUi<HudHandle>(ctx, {
    name: HUD_TAG,
    position: "overlay",
    anchor: "body",
    onMount: (container) => renderHud(container, onStop),
    onRemove: (handle) => handle?.destroy(),
  })
  ui.mount()
  // onMount has run synchronously by now, so ui.mounted is the HudHandle.
  return { hud: ui.mounted!, remove: () => ui.remove() }
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  // Required by createShadowRootUi: hands style.css to the draft card's shadow
  // root instead of injecting it into LinkedIn's document.
  cssInjectionMode: "ui",
  main(ctx) {
    // A contact-info overlay tab is a background tab the run itself opened to
    // read one lead's email/phone. It must do NOTHING else here — no scanning,
    // no HUD, no badging, no passive drain — so this is gated FIRST, before any
    // other work. Extract, report, and return.
    if (isContactInfoPath(location.pathname)) {
      void reportContactInfo()
      return
    }

    // Independent of the scan/agent machinery below: a profile page has no
    // result cards, and a search page has no pending draft.
    mountDraftCard(ctx).catch((err) =>
      console.debug("Glint: mountDraftCard failed", err)
    )

    // An unpacked extension never auto-updates — Chrome keeps running whatever
    // was loaded last. Print the build stamp so a stale extension announces
    // itself instead of masquerading as a code bug.
    console.info(`Glint: content script active (build ${__GLINT_BUILD__})`)

    // The per-card ring. A <style> in the page (not the shadow root) because it
    // decorates LinkedIn's own card elements, which the shadow root cannot see.
    const ring = document.createElement("style")
    ring.textContent = `.${SCANNING_CLASS} {
      box-shadow: 0 0 0 2px #15803d, 0 6px 18px rgba(21,128,61,.18) !important;
      border-radius: 8px;
      transition: box-shadow .2s ease;
    }`
    document.head.append(ring)

    let agentActive = false
    let observerAttached = false
    // True for the whole lifetime of the page step run on THIS tab, from the
    // moment it's launched until its promise settles. Used to stop the
    // browser.storage.onChanged listener from re-arming passive mode while
    // the page step is still unwinding (e.g. mid scoreLead()) after Stop —
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
        // Passive badging is safe from InvalidFolderError today only because
        // this call always passes a null folder, and the server guards folder
        // validation behind `if (folder_id)` -- an invariant that lives in
        // another repo layer, not here. Catch anything anyway: a passive badge
        // failing must never take down the observer loop that drives it.
        try {
          const result = await scoreLead(cand, null)
          if (result) {
            injectBadge(node, result.match_score, result.match_reasons, result.min_score)
          }
        } catch (err) {
          console.warn("Glint: passive scoreLead failed", err)
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
      // Don't re-arm passive mode here if this tab's own page step is still
      // unwinding (e.g. finishing a scoreLead() call after Stop cleared
      // glint_run). runPageStep()'s .finally() below is the one that calls
      // startPassive() once the step has actually exited, sequencing the
      // handoff instead of racing it.
      if (!agentActive && !loopRunning) startPassive()
    })

    // Resolve BOTH this tab's own id and the run state BEFORE doing any
    // passive scanning/observing or deciding to drive the page step. On a
    // search-results page the background just navigated to for a new run,
    // scanning synchronously at startup (before this resolves) would score
    // cards passively right before the agent gate closes — the exact
    // double-scoring the run mode exists to prevent. And critically: only
    // drive runPageStep() when this tab IS the run's own tab (state.tabId
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
        mountHud(ctx, () => sendMessage({ type: "STOP_RUN" }))
          .then(({ hud, remove }) =>
            // An unexpected throw from the page step (e.g. findSearchResultCards
            // / extractFromNode choking on hostile markup) would otherwise reject
            // out to the outer .catch: the HUD is torn down and passive mode
            // resumes, but glint_run stays active: true with nothing driving it,
            // clearing only when reconcileRunState()'s maxMinutes backstop fires.
            // Catch it here and stopRun so the run ends now. This only fires on a
            // real throw — a deliberate navigate or an already-issued stopRun
            // returns normally and never reaches here. finally(remove) is
            // untouched: a bare `return` inside the card loop still removes the HUD.
            runPageStep(myTabId!, hud)
              .catch((err) => {
                console.error("Glint: page step failed", err)
                return stopRun("Something went wrong on this page")
              })
              .finally(remove)
          )
          .catch((err) => console.debug("Glint: mountHud failed", err))
          .finally(() => {
            loopRunning = false
            startPassive()
          })
      } else {
        startPassive()
      }
    })
  },
})
