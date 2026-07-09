import { isLinkedIn, isPreNavigation } from "@/lib/linkedin"
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError, QueryServiceError, NetworkError } from "@/lib/query"
import { getRunState, setRunState, clearRunState, isRunning, type PauseReason, type RunState } from "@/lib/run"
import { LINKEDIN_MAX_PAGE } from "@/lib/agent-step"
import { getActiveSiteId, getDeviceToken } from "@/lib/pairing"
import {
  DAILY_PROFILE_VIEW_BUDGET,
  nextEnrichPassStep,
  remainingBudget,
  spendBudget,
  type EnrichTarget,
} from "@/lib/enrich-pass"
import {
  clearEnrichPass,
  getEnrichBudget,
  getEnrichPass,
  setEnrichBudget,
  setEnrichPass,
} from "@/lib/enrich-store"
import { CONTACT_INFO_PATH } from "@/lib/contact"
import { sendRuntimeMessage, type RuntimeMessage, type WhichTabResponse } from "@/lib/messages"

// Depth, not breadth: LinkedIn returns at most 1,000 people per search, across
// 100 pages of 10. A run now goes as far as the query itself allows.
const DEFAULT_MAX_LEADS = 1000

// A runaway backstop, not the intended bound. A full-depth run is a 30-60
// minute affair, and pause time does not stop this clock — so it must be far
// enough out that it never truncates an honest run, and near enough that a
// wedged one cannot outlive the browser session.
const DEFAULT_MAX_MINUTES = 240

// How long a single contact-info lookup may take before it is abandoned. A tab
// that never loads, a 302 to the profile, or a modal that renders nothing all
// hit this. On expiry the lead is enriched with nulls anyway (so enriched_at is
// stamped and the card reads "No public contact info" rather than "Not looked up
// yet" forever) and the pass continues. A failed lookup must never stop a pass.
const ENRICH_TIMEOUT_MS = 10_000

// Human pacing between profile visits. Profile views are the expensive,
// account-risking action; this is never a burst.
const ENRICH_MIN_GAP_MS = 2_000
const ENRICH_MAX_GAP_MS = 5_000

// The run window. Deliberately not maximized: Chrome reports a window `hidden`
// only when it is COMPLETELY covered, so a window the user can leave a sliver of
// keeps its timers, rAF, and IntersectionObserver alive. See RunState.windowId.
const RUN_WINDOW_WIDTH = 900
const RUN_WINDOW_HEIGHT = 800

// Fires while a run is live. Its jobs: enforce the time cap when no content
// script is left to notice, pause a run whose tab was discarded/closed/frozen,
// and un-pause a `hidden` run once its window is visible again. 1 minute is the
// finest useful period (chrome.alarms floors at 30s) and this is a watchdog, not
// the run's clock — the content script drives the run.
const WATCHDOG_ALARM = "glint-run-watchdog"
const WATCHDOG_PERIOD_MINUTES = 1

const env = import.meta.env as unknown as Record<string, string>

// Thrown when the run state was persisted successfully but opening or
// navigating the run window failed. Kept distinct from parse/transport failures
// so startRun's catch can report an accurate, non-misleading message.
class NavigationError extends Error {}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs)
  return new Promise((r) => setTimeout(r, ms))
}

async function syncPanelForTab(tabId: number, url: string | undefined) {
  const enabled = isLinkedIn(url)
  try {
    // Pass `path` only when enabling. Chrome's own site-specific side-panel
    // example omits it on the disable call, and sending both can reject —
    // which the catch below would swallow, leaving the panel enabled and
    // following the user onto every site.
    await chrome.sidePanel.setOptions(
      enabled ? { tabId, path: "sidepanel.html", enabled: true } : { tabId, enabled: false }
    )
  } catch (err) {
    // tab may have closed mid-update; ignore, but keep it visible
    console.debug("Glint: syncPanelForTab failed", tabId, enabled, err)
  }
}

function sendMessage(message: RuntimeMessage) {
  sendRuntimeMessage(message)
}

// The side panel shows live progress while it's open, but the user can close it
// mid-run — and a full-depth run lasts the better part of an hour. The toolbar
// badge is the surface that survives that. Per-tab, because a run belongs to
// exactly one tab and a global badge would claim every other window was running
// too.
function paintBadge(tabId: number, leadCount: number) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#15803d" }).catch(() => {})
  // Chrome truncates badge text past ~4 characters, and silently — so cap it
  // rather than render a number that reads as a different, smaller number.
  chrome.action
    .setBadgeText({ tabId, text: leadCount > 999 ? "999+" : String(leadCount) })
    .catch(() => {})
}

function clearBadge(tabId: number) {
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {})
}

/* ------------------------------------------------------------------ *
 * Run lifecycle
 * ------------------------------------------------------------------ */

/**
 * What the user is told, per pause reason. The `hidden` line is the load-bearing
 * one: it is the only pause the user can prevent, and the only one that will
 * otherwise look like Glint silently stopped working.
 */
function pauseMessage(reason: PauseReason): string {
  switch (reason) {
    case "user":
      return "Paused."
    case "hidden":
      return "Paused — keep the Glint window visible. Chrome freezes hidden tabs."
    case "tab_lost":
      return "Paused — the run's tab is gone. Resume to reopen it."
    case "commercial_limit":
      return "Paused — LinkedIn's search limit. Resume later to continue from this page."
  }
}

/**
 * Opens the run's own window, on about:blank.
 *
 * Not on the search URL directly: the content script would load and read
 * glint_run before this function's caller has had a chance to write the new
 * tabId into it, so the script would decide it wasn't the run's tab and fall
 * back to passive mode. about:blank runs no content script, which lets the
 * caller persist state first and navigate second — the same ordering startRun
 * has always relied on.
 *
 * Focused, because a window created behind a maximized window is *fully
 * occluded*, which Chrome reports as `hidden` — the run would pause the instant
 * it started. The user moves focus back themselves; an unfocused-but-visible
 * window is exactly the state a run wants.
 */
async function openRunWindow(): Promise<{ tabId: number; windowId: number }> {
  const win = await chrome.windows.create({
    url: "about:blank",
    focused: true,
    type: "normal",
    width: RUN_WINDOW_WIDTH,
    height: RUN_WINDOW_HEIGHT,
  })
  const tabId = win?.tabs?.[0]?.id
  if (win?.id === undefined || tabId === undefined) {
    throw new NavigationError("could not open the Glint run window")
  }
  return { tabId, windowId: win.id }
}

async function startRun(query: string, maxPages: number, folderId: string | null) {
  try {
    const parsed = await parseQuery(query)
    // Pinned once. Switching site in the panel mid-run must not retarget the
    // leads this run is still writing.
    const siteId = await getActiveSiteId()
    const { tabId, windowId } = await openRunWindow()

    // Persist run state *before* navigating — the future content script reads
    // glint_run on load, so it must already be running by the time the tab
    // lands on the search results page.
    await setRunState({
      status: "running",
      pauseReason: null,
      tabId,
      windowId,
      query,
      // Cached so page 2's URL costs no LLM call.
      parsed,
      startedAt: Date.now(),
      leadCount: 0,
      maxLeads: DEFAULT_MAX_LEADS,
      maxMinutes: DEFAULT_MAX_MINUTES,
      page: 1,
      // A run persisted with maxPages > LinkedIn's ceiling would navigate past
      // page 100 and re-scan page 100's results under every later URL.
      maxPages: Math.min(Math.max(1, maxPages), LINKEDIN_MAX_PAGE),
      folderId,
      siteId,
      seen: [],
      phase: "scanning",
    })

    try {
      await chrome.tabs.update(tabId, { url: buildSearchUrl(parsed, 1) })
    } catch (navErr) {
      // Navigation failed after we already marked the run running — don't
      // strand glint_run with nothing driving it. Cleanup is wrapped so a
      // rejection here can't mask the real NavigationError with the generic
      // fallback message below, re-stranding the run.
      try {
        await endRun()
      } catch (cleanupErr) {
        console.error("Glint: endRun failed after navigation error", cleanupErr)
      }
      throw new NavigationError(
        navErr instanceof Error ? navErr.message : "tabs.update failed"
      )
    }

    startWatchdog()
    // Only once navigation is committed. Painting before it would leave a "0"
    // on the toolbar of a tab that never started a run, if tabs.update threw.
    paintBadge(tabId, 0)
  } catch (err) {
    console.error("Glint: startRun failed", err)
    const error =
      err instanceof UnpairedError
        ? "Not paired. Open the popup and pair first."
        : err instanceof NoIcpError
          ? "No ICP found. Complete onboarding in the web app first."
          : err instanceof NavigationError
            ? "Could not open the Glint run window. Try again."
            : err instanceof QueryServiceError
              ? "Search service is unavailable right now. Try again in a moment."
              : err instanceof NetworkError
                ? "Network error — check your connection and try again."
                : "Could not parse your request. Try again."
    sendMessage({ type: "RUN_ERROR", error })
  }
}

/**
 * Halts a run without destroying it.
 *
 * Everything a resume needs — `page`, `seen`, `leadCount` — is already in
 * glint_run, so pausing is just a status flip. That is the whole reason
 * `seen` was made a persisted array rather than a local Set: resuming re-reads
 * it and skips every lead already scored, so a resumed run never re-spends
 * LinkedIn's commercial-use budget on pages it has already walked.
 *
 * Idempotent. The content script, the watchdog, and the panel can all reach for
 * the same pause; the first one wins and the rest are no-ops.
 */
async function pauseRun(reason: PauseReason): Promise<void> {
  const state = await getRunState()
  if (!isRunning(state)) return
  const paused: RunState = { ...state!, status: "paused", pauseReason: reason }
  await setRunState(paused)
  sendMessage({ type: "PAUSED", reason, message: pauseMessage(reason) })
}

/**
 * Resumes a paused run, reopening its window or tab if they are gone.
 *
 * When the tab is still alive (the `hidden` and `user` pauses), the status flip
 * alone is enough: the content script's own storage.onChanged listener sees the
 * run go back to `running` and re-drives the page step. Re-scanning a partly
 * scanned page is safe and cheap — `seen` makes it idempotent.
 */
async function resumeRun(): Promise<void> {
  const state = await getRunState()
  if (!state || state.status !== "paused") return

  const url = buildSearchUrl(state.parsed, state.page)
  const tab = await chrome.tabs.get(state.tabId).catch(() => null)

  if (!tab || tab.discarded || !isLinkedIn(tab.url)) {
    // The tab is gone, was discarded by Chrome's memory saver, or the user
    // navigated it off LinkedIn. A tab that still exists is reloaded in place —
    // navigating it is what un-discards it — and only a vanished one costs a new
    // window. Either way, re-point state at the surface BEFORE navigating: the
    // content script reads glint_run on load and must find its own tab id there,
    // or it decides it isn't the run's tab and falls back to passive mode.
    try {
      const opened = tab ? null : await openRunWindow()
      const tabId = opened?.tabId ?? state.tabId
      const windowId = opened?.windowId ?? state.windowId
      await setRunState({ ...state, status: "running", pauseReason: null, tabId, windowId })
      await chrome.tabs.update(tabId, { url })
      startWatchdog()
      paintBadge(tabId, state.leadCount)
      return
    } catch (err) {
      console.error("Glint: resumeRun could not reopen the run window", err)
      sendMessage({ type: "RUN_ERROR", error: "Could not reopen the Glint run window." })
      return
    }
  }

  await setRunState({ ...state, status: "running", pauseReason: null })
  startWatchdog()
}

/**
 * Ends a run for good and clears its state.
 *
 * Reading glint_run before clearing is not an optimization: the badge is keyed
 * by the run's own tab id, which is only knowable from the state, so skipping
 * the read strands a stale count on the toolbar for the life of the tab.
 */
async function endRun(reason?: string): Promise<void> {
  const state = await getRunState()
  await clearRunState()
  if (state) clearBadge(state.tabId)
  stopWatchdog()
  if (reason) sendMessage({ type: "STOPPED", reason })
}

/* ------------------------------------------------------------------ *
 * Watchdog
 * ------------------------------------------------------------------ */

function startWatchdog() {
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES })
}

function stopWatchdog() {
  chrome.alarms.clear(WATCHDOG_ALARM).catch(() => {})
}

/**
 * The backstop for everything the content script cannot report itself.
 *
 * A discarded or frozen tab runs no JavaScript, so it can neither pause the run
 * nor tell anyone it stopped. A run whose window the user minimized before the
 * content script noticed is in the same position. Without this, such a run sits
 * at `running` forever with nothing driving it.
 *
 * This watchdog only ever PAUSES. Resuming is the content script's job, via
 * `visibilitychange`, and it has to be: Chrome reports a fully-occluded window
 * as `hidden`, but `windows.get()` still calls its state "normal". A watchdog
 * that resumed on "not minimized" would un-pause a run whose page is still
 * hidden, the content script would re-pause it on its next card, and the two
 * would trade the run back and forth once a minute forever.
 */
async function watchdogTick(): Promise<void> {
  const state = await getRunState()
  if (!state) {
    stopWatchdog()
    return
  }
  if (state.status !== "running") return

  if (Date.now() - state.startedAt >= state.maxMinutes * 60_000) {
    await endRun("Reached time limit")
    return
  }
  const tab = await chrome.tabs.get(state.tabId).catch(() => null)
  if (!tab) {
    await pauseRun("tab_lost")
    return
  }
  // A run window that hasn't reached its search URL yet is starting, not lost.
  if (isPreNavigation(tab.url)) return
  if (tab.discarded || !isLinkedIn(tab.url)) {
    await pauseRun("tab_lost")
    return
  }
  // A minimized window is `hidden`, and a hidden page's timers are throttled to
  // one wake-up per MINUTE after five minutes — so the content script may be too
  // throttled to have reported this itself. Un-minimizing fires visibilitychange
  // in the page, which resumes the run.
  if (state.windowId !== null) {
    const win = await chrome.windows.get(state.windowId).catch(() => null)
    if (win?.state === "minimized") await pauseRun("hidden")
  }
}

/**
 * Clears a run that can no longer possibly be driven, or pauses one that can be
 * recovered.
 *
 * A browser restart reassigns tab ids, so a run persisted across it can never
 * match a content script again — but its `page` and `seen` are still good, and
 * a Resume can reopen the window. That is a pause, not a death. Only the time
 * cap ends a run here.
 */
async function reconcileRunState(navigatedTabId?: number): Promise<void> {
  const state = await getRunState()
  if (!state) return
  if (navigatedTabId !== undefined && navigatedTabId !== state.tabId) return

  if (Date.now() - state.startedAt >= state.maxMinutes * 60_000) {
    console.debug("Glint: ending orphaned run — time cap elapsed", state.tabId)
    await endRun("Reached time limit")
    return
  }
  if (!isRunning(state)) return
  // Alarms survive a service-worker eviction, but not an extension reload — and
  // a run persisted across one still needs its watchdog. create() is idempotent.
  startWatchdog()

  const tab = await chrome.tabs.get(state.tabId).catch(() => null)
  if (!tab) {
    console.debug("Glint: pausing run — tab no longer exists", state.tabId)
    await pauseRun("tab_lost")
    return
  }
  // Still on about:blank — startRun has written the state but not yet applied the
  // search URL. Starting is not the same as lost.
  if (isPreNavigation(tab.url)) return
  // The tab is alive but has genuinely navigated off LinkedIn, so no content
  // script can be driving it. A LinkedIn URL — even mid-load, backgrounded, or
  // mid-SPA-navigation — is left alone; isLinkedIn() only ever returns false for
  // a real cross-origin navigation.
  if (!isLinkedIn(tab.url)) {
    console.debug("Glint: pausing run — tab navigated away from LinkedIn", state.tabId, tab.url)
    await pauseRun("tab_lost")
  }
}

/* ------------------------------------------------------------------ *
 * Contact-info enrichment pass
 * ------------------------------------------------------------------ */

// An in-flight contact-info lookup, keyed by the contact-info tab's id. In
// memory only: this map exists solely to correlate an incoming CONTACT_INFO to
// the tab we opened for it. If the service worker is evicted mid-lookup the
// lookup's promise settles on its timeout, the pass fails soft and moves on, and
// the opened tab is still recorded in the persisted pass state — so the startup
// sweep closes it regardless.
type PendingEnrich = {
  finish: (email: string | null, phone: string | null, enrich?: boolean) => void
}
const pendingEnrich = new Map<number, PendingEnrich>()

// True while the pass loop is running in THIS service-worker generation. Guards
// against two loops walking the same queue when a START_ENRICH races the
// startup resume.
let enrichLoopRunning = false

/**
 * Writes enrichment onto a lead. Fail-soft by contract: any failure (unpaired,
 * network, non-2xx) is swallowed so a single bad lookup can never stop a pass —
 * the card just stays "Not looked up yet" until a later pass retries it. On the
 * common failure (a lookup that found nothing), NEITHER email nor phone is sent
 * and the server still stamps enriched_at, so the card reads "No public contact
 * info" instead.
 *
 * Only the keys we ACTUALLY extracted a value for are put in the body. The
 * enrich-lead handler writes any key PRESENT in the body — including an explicit
 * null — and leaves absent keys untouched. So sending `email: null` would
 * OVERWRITE a real email a previous pass captured; on a replay that is silent
 * loss of the exact data this feature exists to collect. A null therefore
 * becomes an ABSENT key, never an explicit null. enriched_at is stamped
 * unconditionally by the handler regardless of which keys are present.
 */
async function enrichLead(
  leadId: string,
  email: string | null,
  phone: string | null
): Promise<void> {
  try {
    const device_token = await getDeviceToken()
    if (!device_token) return
    const body: {
      device_token: string
      lead_id: string
      email?: string
      phone?: string
    } = { device_token, lead_id: leadId }
    if (email !== null) body.email = email
    if (phone !== null) body.phone = phone
    await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/enrich-lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.WXT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.debug("Glint: enrich-lead failed", leadId, err)
  }
}

/** Records a tab the pass opened, so a crash can't strand it invisibly. */
async function addOpenedTabId(tabId: number): Promise<void> {
  const pass = await getEnrichPass()
  if (!pass?.active) {
    // The pass was stopped between opening this tab and recording it; nothing
    // will ever close it but us.
    chrome.tabs.remove(tabId).catch(() => {})
    return
  }
  if (!pass.openedTabIds.includes(tabId)) {
    await setEnrichPass({ ...pass, openedTabIds: [...pass.openedTabIds, tabId] })
  }
}

async function removeOpenedTabId(tabId: number): Promise<void> {
  const pass = await getEnrichPass()
  if (pass && pass.openedTabIds.includes(tabId)) {
    await setEnrichPass({
      ...pass,
      openedTabIds: pass.openedTabIds.filter((id) => id !== tabId),
    })
  }
}

/**
 * Visits one lead's contact-info overlay in a background tab, extracts what it
 * finds, writes it, and closes the tab. Resolves when the tab is gone.
 *
 * Serial by construction — the pass loop awaits this before starting the next.
 * Ten simultaneous profile loads is a browsing pattern no human produces.
 */
async function lookupContactInfo(leadId: string, url: string): Promise<void> {
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.create({ url, active: false })
  } catch (err) {
    console.debug("Glint: enrich tab create failed", err)
    return
  }
  const contactTabId = tab.id
  if (contactTabId === undefined) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = async (
      email: string | null,
      phone: string | null,
      enrich = true
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingEnrich.delete(contactTabId)
      if (enrich) await enrichLead(leadId, email, phone)
      chrome.tabs.remove(contactTabId).catch(() => {})
      await removeOpenedTabId(contactTabId)
      resolve()
    }
    const timer = setTimeout(() => void finish(null, null), ENRICH_TIMEOUT_MS)
    // Register the pending entry BEFORE the addOpenedTabId storage round-trip
    // below. The content script on the just-created contact-info tab can fire a
    // CONTACT_INFO the instant it loads — often faster than that await resolves.
    // With no entry yet, that message is dropped and the lookup only resolves via
    // the 10s timeout as (null, null), falsely recording "No public contact info".
    pendingEnrich.set(contactTabId, { finish })
    void addOpenedTabId(contactTabId)
  })
}

/** Aborts every in-flight lookup and closes every tab the pass opened. */
function sweepEnrichTabs(tabIds: Iterable<number>): void {
  const pendings = Array.from(pendingEnrich.values())
  pendingEnrich.clear()
  // enrich:false is deliberate — a lookup cut short by a stop must not be
  // recorded as "no contact info".
  for (const p of pendings) p.finish(null, null, false)
  for (const id of tabIds) chrome.tabs.remove(id).catch(() => {})
}

async function endEnrichPass(reason: string, enriched: number): Promise<void> {
  const pass = await getEnrichPass()
  await clearEnrichPass()
  sweepEnrichTabs(pass?.openedTabIds ?? [])
  sendMessage({ type: "ENRICH_STOPPED", reason, enriched })
}

/**
 * Walks the pass queue, one profile at a time, until it drains, is stopped, or
 * runs out of daily budget.
 *
 * State is re-read from storage each step, so a Stop lands between leads and a
 * service-worker eviction resumes exactly where it left off. The budget is
 * spent BEFORE the lookup, not after: a view that crashed us mid-flight was
 * still a view LinkedIn counted.
 */
async function runEnrichPass(): Promise<void> {
  if (enrichLoopRunning) return
  enrichLoopRunning = true
  try {
    for (;;) {
      const pass = await getEnrichPass()
      if (!pass) return
      const budget = await getEnrichBudget()
      const now = Date.now()
      const step = nextEnrichPassStep(pass, remainingBudget(budget, now))

      if (step.kind === "done") {
        await endEnrichPass(
          `Looked up ${pass.index} lead${pass.index === 1 ? "" : "s"}.`,
          pass.index
        )
        return
      }
      if (step.kind === "stop") {
        await endEnrichPass(step.reason, pass.index)
        return
      }

      sendMessage({
        type: "ENRICH_PROGRESS",
        done: step.index,
        total: step.total,
        status: step.label,
      })

      await setEnrichBudget(spendBudget(budget, now))
      const url = `https://www.linkedin.com${CONTACT_INFO_PATH(step.profilePath)}`
      try {
        await lookupContactInfo(step.leadId, url)
      } catch (err) {
        // A failed lookup must never stop a pass.
        console.debug("Glint: contact-info lookup failed", step.leadId, err)
      }

      // Re-read: a STOP_ENRICH may have landed during the lookup, and writing
      // back a pre-await snapshot would resurrect a cancelled pass.
      const after = await getEnrichPass()
      if (!after) return
      await setEnrichPass({ ...after, index: after.index + 1 })
      await randomDelay(ENRICH_MIN_GAP_MS, ENRICH_MAX_GAP_MS)
    }
  } finally {
    enrichLoopRunning = false
  }
}

async function startEnrichPass(targets: EnrichTarget[]): Promise<void> {
  const existing = await getEnrichPass()
  if (existing?.active) {
    sendMessage({
      type: "ENRICH_STOPPED",
      reason: "A contact-info lookup is already running.",
      enriched: 0,
    })
    return
  }
  const budgetLeft = remainingBudget(await getEnrichBudget(), Date.now())
  if (budgetLeft <= 0) {
    sendMessage({
      type: "ENRICH_STOPPED",
      reason: `Daily contact-info limit reached (${DAILY_PROFILE_VIEW_BUDGET}). Try again tomorrow.`,
      enriched: 0,
    })
    return
  }
  // Trim to the budget up front so the panel's count is honest about what this
  // pass will actually do, rather than promising 200 and halting at 50.
  await setEnrichPass({
    active: true,
    queue: targets.slice(0, budgetLeft),
    index: 0,
    openedTabIds: [],
    startedAt: Date.now(),
  })
  void runEnrichPass()
}

async function stopEnrichPass(): Promise<void> {
  const pass = await getEnrichPass()
  if (!pass) return
  // Flip active off rather than clearing: the loop is mid-lookup and re-reads
  // state between leads. It will see this and end the pass itself, closing its
  // own tabs. Clearing here would let the loop write a fresh pass back.
  await setEnrichPass({ ...pass, active: false })
}

/**
 * Startup sweep for contact-info orphans.
 *
 * lookupContactInfo creates the tab and only then records its id (the id cannot
 * exist before create resolves), so a service-worker eviction or a browser crash
 * inside that window strands a contact-info overlay tab with no owner to close
 * it. Gated on a pass existing: without that gate this would close a
 * contact-info overlay the USER opened by hand, which is the extension reaching
 * in and shutting the user's own tab.
 */
async function sweepContactInfoOrphans(): Promise<void> {
  try {
    const pass = await getEnrichPass()
    if (!pass) return
    const tabs = await chrome.tabs.query({
      url: "*://*.linkedin.com/in/*/overlay/contact-info/*",
    })
    const claimed = new Set(pass.openedTabIds)
    for (const tab of tabs) {
      if (tab.id !== undefined && !claimed.has(tab.id)) {
        chrome.tabs.remove(tab.id).catch(() => {})
      }
    }
    // A pass that survived the eviction resumes where its cursor left off.
    if (pass.active) void runEnrichPass()
    else await endEnrichPass("Stopped", pass.index)
  } catch (err) {
    console.debug("Glint: contact-info orphan sweep failed", err)
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

// Guards against a second START_RUN clobbering an in-flight run. The side
// panel's `running` flag can't be trusted for this: it's per-document, and a
// second window's side panel is an independently mounted document that has no
// idea another one already has a run. glint_run is the only shared source of
// truth, so it's checked here before we ever call startRun.
async function handleStartRunMessage(
  query: string,
  maxPages: number,
  folderId: string | null
) {
  const state = await getRunState()
  if (state) {
    sendMessage({
      type: "RUN_ERROR",
      error:
        state.status === "paused"
          ? "A search is paused. Resume or stop it first."
          : "A search is already running. Stop it first.",
    })
    return
  }
  await startRun(query, maxPages, folderId)
}

export default defineBackground(() => {
  if (import.meta.env.BROWSER === "chrome") {
    // One-time sync for tabs that were already open when the extension
    // installed/reloaded — onUpdated/onActivated only fire on future
    // transitions, so without this, already-open tabs stay "enabled
    // everywhere" (the side_panel.default_path default) until the user
    // navigates or switches tabs.
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          syncPanelForTab(tab.id, tab.url)
        }
      }
    })

    // Reconcile once at every service-worker startup. An MV3 SW is evicted when
    // idle and restarts often (on its own, and definitely across a browser
    // restart), so this runs naturally and regularly — it's what catches a run
    // left running after the browser itself was restarted with glint_run still
    // persisted (session restore gives the tab a new id, so no content script
    // will ever match state.tabId again). That run is paused, not destroyed.
    reconcileRunState()

    // Close any contact-info overlay tab a prior pass left orphaned across this
    // SW restart, and resume the pass if it was still active.
    sweepContactInfoOrphans()

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === WATCHDOG_ALARM) void watchdogTick()
    })

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url !== undefined || changeInfo.status === "complete") {
        syncPanelForTab(tabId, tab.url)
      }
      // The "navigated away" trigger: only a URL change can turn a live,
      // on-LinkedIn run tab into an orphan, so that's the only changeInfo that
      // needs to re-check. navigatedTabId lets reconcileRunState() skip its work
      // for every tab update that isn't the run's own tab.
      if (changeInfo.url !== undefined) {
        reconcileRunState(tabId)
      }
    })

    chrome.tabs.onActivated.addListener(({ tabId }) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return
        syncPanelForTab(tabId, tab.url)
      })
    })

    chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
      if (message.type === "START_RUN") {
        void handleStartRunMessage(message.query, message.maxPages, message.folderId)
      } else if (message.type === "STOP_RUN") {
        void endRun("Stopped")
      } else if (message.type === "PAUSE_RUN") {
        void pauseRun(message.reason)
      } else if (message.type === "RESUME_RUN") {
        void resumeRun()
      } else if (message.type === "NAVIGATE") {
        // Only ever from the run's own tab, and only to a LinkedIn URL we built
        // ourselves. Both are checked: a content script is the least trusted
        // sender in the extension, and tabs.update is a navigation primitive.
        const tabId = sender.tab?.id
        if (tabId === undefined || !isLinkedIn(message.url)) return
        getRunState().then((state) => {
          if (isRunning(state) && state!.tabId === tabId) {
            chrome.tabs.update(tabId, { url: message.url }).catch((err) => {
              console.error("Glint: NAVIGATE failed", err)
              // Recoverable: the page is still in state, so a Resume retries it.
              void pauseRun("tab_lost")
            })
          }
        })
      } else if (message.type === "PROGRESS") {
        // Sent by the content script driving the run, so sender.tab IS the run's
        // own tab — no need to re-read glint_run to know which badge to paint.
        // The panel listens for this message too, independently.
        if (sender.tab?.id !== undefined) paintBadge(sender.tab.id, message.leadCount)
      } else if (message.type === "STOPPED") {
        // The content script stops the run itself (caps, no-cards, a deleted
        // folder) by clearing glint_run and announcing it here, so this is the
        // only place that learns the badge is now stale.
        if (sender.tab?.id !== undefined) clearBadge(sender.tab.id)
        stopWatchdog()
      } else if (message.type === "START_ENRICH") {
        void startEnrichPass(message.targets)
      } else if (message.type === "STOP_ENRICH") {
        void stopEnrichPass()
      } else if (message.type === "CONTACT_INFO") {
        // The least-trusted sender in the extension. It is only honoured when it
        // comes from a tab THIS pass opened for a lookup — i.e. one with a
        // pending entry. Anything else (a stray content script, a spoofed
        // message) has no entry and is silently dropped.
        const tabId = sender.tab?.id
        if (tabId === undefined) return
        const entry = pendingEnrich.get(tabId)
        if (entry) entry.finish(message.email, message.phone)
      } else if (message.type === "WHICH_TAB") {
        // Answer synchronously (no await needed), but we must still return
        // `true` here — and only here — to tell Chrome to keep the message
        // channel open for sendResponse. Returning true unconditionally from
        // this listener would keep the port open for START_RUN/STOP_RUN too,
        // which never call sendResponse and must keep returning undefined.
        sendResponse({ tabId: sender.tab?.id ?? null } satisfies WhichTabResponse)
        return true
      }
    })

    chrome.tabs.onRemoved.addListener(async (closedTabId) => {
      const state = await getRunState()
      // The run's own tab closing PAUSES the run — it does not end it. `page`
      // and `seen` are still good, and Resume reopens the window where it left
      // off. A contact-info tab closing (by us, or by the user) is expected: its
      // pending lookup times out and the pass carries on.
      if (isRunning(state) && state!.tabId === closedTabId) {
        await pauseRun("tab_lost")
      }
    })

    // Closing the run's window is closing its tab, but onRemoved does not fire
    // for tabs destroyed with their window in every Chrome version — so pause on
    // this too. pauseRun is idempotent, so a doubled signal is harmless.
    chrome.windows.onRemoved.addListener(async (closedWindowId) => {
      const state = await getRunState()
      if (isRunning(state) && state!.windowId === closedWindowId) {
        await pauseRun("tab_lost")
      }
    })
  }
})
