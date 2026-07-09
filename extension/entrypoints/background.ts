import { isLinkedIn } from "@/lib/linkedin"
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError, QueryServiceError, NetworkError } from "@/lib/query"
import { getRunState, setRunState, clearRunState } from "@/lib/run"
import { getDeviceToken } from "@/lib/pairing"
import { sendRuntimeMessage, type RuntimeMessage, type WhichTabResponse, type EnrichResponse } from "@/lib/messages"

const DEFAULT_MAX_LEADS = 100
const DEFAULT_MAX_MINUTES = 20

// How long a single contact-info lookup may take before it is abandoned. A tab
// that never loads, a 302 to the profile, or a modal that renders nothing all
// hit this. On expiry the lead is enriched with nulls anyway (so enriched_at is
// stamped and the card reads "No public contact info" rather than "Not looked up
// yet" forever) and the run continues. A failed lookup must never stop a run.
const ENRICH_TIMEOUT_MS = 10_000

const env = import.meta.env as unknown as Record<string, string>

// Thrown when the run state was persisted successfully but navigating the
// tab to the search URL failed (blocked/disallowed navigation, discarded
// tab, restricted page, etc). Kept distinct from parse/transport failures so
// startRun's catch can report an accurate, non-misleading message.
class NavigationError extends Error {}

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
// mid-run — and a run lasts up to maxMinutes. The toolbar badge is the surface
// that survives that. Per-tab, because a run belongs to exactly one tab and a
// global badge would claim every other window was running too.
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

// An in-flight contact-info lookup, keyed by the contact-info tab's id. In
// memory only: this map exists solely to correlate an incoming CONTACT_INFO to
// the tab we opened for it. If the service worker is evicted mid-lookup the
// ENRICH promise rejects, the run tab fails soft and moves on, and the opened
// tab is still recorded in glint_run.openedTabIds — so endRun/reconcile close it
// regardless. `finish` is idempotent (guarded by `settled`); calling it with
// enrich:false abandons the lookup without writing enrichment (used on Stop).
type PendingEnrich = {
  finish: (email: string | null, phone: string | null, enrich?: boolean) => void
}
const pendingEnrich = new Map<number, PendingEnrich>()

// A background-held mirror of glint_run.openedTabIds. A content-script self-stop
// (caps, commercial-limit banner, no-cards, InvalidFolderError, the "Something
// went wrong" catch, the enrichment time cap) clears glint_run in the content
// script and only THEN sends STOPPED — so by the time the STOPPED handler runs,
// openedTabIds is already gone from storage and there is nothing left to sweep.
// This in-memory copy is the only record of the run's tabs at STOPPED time, so
// the handler can still close them. Kept in sync wherever openedTabIds is
// mutated. It is lost on SW eviction — but the startup contact-info sweep in
// defineBackground closes any orphan a lost mirror would otherwise leave behind.
const openedTabIdsMirror = new Set<number>()

// Records a tab this run opened so endRun() can guarantee it is closed. If the
// run vanished between opening the tab and this write (a Stop that raced), the
// tab has no owner that will ever close it — so close it here and now.
async function addOpenedTabId(tabId: number): Promise<void> {
  const s = await getRunState()
  if (!s?.active) {
    chrome.tabs.remove(tabId).catch(() => {})
    return
  }
  if (!s.openedTabIds.includes(tabId)) {
    s.openedTabIds = [...s.openedTabIds, tabId]
    await setRunState(s)
  }
  openedTabIdsMirror.add(tabId)
}

// Drops a contact-info tab from openedTabIds once it has been closed. A no-op
// after the run was cleared (getRunState() === null), which is correct: endRun
// already closed the tab and there is no list left to prune.
async function removeOpenedTabId(tabId: number): Promise<void> {
  openedTabIdsMirror.delete(tabId)
  const s = await getRunState()
  if (s && s.openedTabIds.includes(tabId)) {
    s.openedTabIds = s.openedTabIds.filter((id) => id !== tabId)
    await setRunState(s)
  }
}

// Writes enrichment onto a lead. Fail-soft by contract: any failure (unpaired,
// network, non-2xx) is swallowed so a single bad lookup can never stop a run —
// the card just stays "Not looked up yet" until a future run retries it. On the
// common failure (a lookup that found nothing), NEITHER email nor phone is sent
// and the server still stamps enriched_at, so the card reads "No public contact
// info" instead.
//
// Only the keys we ACTUALLY extracted a value for are put in the body. The
// enrich-lead handler writes any key PRESENT in the body — including an explicit
// null — and leaves absent keys untouched. So sending `email: null` would
// OVERWRITE a real email a previous pass captured; on a queue replay after a
// tab reload that is silent loss of the exact data this slice exists to collect.
// A null therefore becomes an ABSENT key, never an explicit null. enriched_at is
// stamped unconditionally by the handler regardless of which keys are present.
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

// Opens the lead's contact-info overlay in a background tab, waits for the
// content script there to report (or the timeout), enriches the lead, closes the
// tab, and answers the waiting run tab. Serial by construction: the run tab
// awaits our sendResponse before it asks for the next lead, so exactly one
// background tab is ever open at a time.
async function handleEnrich(
  leadId: string,
  url: string,
  senderTabId: number | undefined,
  sendResponse: (r: EnrichResponse) => void
): Promise<void> {
  const state = await getRunState()
  // Only the run's own tab may drive enrichment, and only to a LinkedIn URL —
  // a content script is the least-trusted sender, and tabs.create is a
  // navigation primitive. On any mismatch, answer immediately so the run tab
  // isn't left awaiting a reply that never comes.
  if (
    senderTabId === undefined ||
    !state?.active ||
    state.tabId !== senderTabId ||
    !isLinkedIn(url)
  ) {
    sendResponse({ done: true })
    return
  }

  // The ideal is to record the tab id BEFORE the tab exists, so a crash can
  // never leave an untracked tab open. That is literally impossible here:
  // chrome.tabs.create is what MINTS the id, so there is nothing to record until
  // it resolves. The startup contact-info sweep (see defineBackground) closes
  // whatever this unavoidable window strands.
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.create({ url, active: false })
  } catch (err) {
    console.debug("Glint: enrich tab create failed", err)
    sendResponse({ done: true })
    return
  }
  const contactTabId = tab.id
  if (contactTabId === undefined) {
    sendResponse({ done: true })
    return
  }

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
    sendResponse({ done: true })
  }
  const timer = setTimeout(() => {
    void finish(null, null)
  }, ENRICH_TIMEOUT_MS)
  // Register the pending entry BEFORE the addOpenedTabId storage round-trip
  // below. The content script on the just-created contact-info tab can fire a
  // CONTACT_INFO the instant it loads — often faster than that await resolves.
  // With no entry yet, that message is dropped and the lookup only resolves via
  // the 10s timeout as (null, null), falsely recording "No public contact info".
  // The entry needs contactTabId (only known after create resolves), so this is
  // as early as it can possibly go.
  pendingEnrich.set(contactTabId, { finish })

  await addOpenedTabId(contactTabId)
}

// Every path that ends a run must also clear that run's badge, and the badge is
// keyed by the run's own tab id — which is only knowable from glint_run. Reading
// it before clearing is therefore not an optimization; skipping it strands a
// stale count on the toolbar for the life of the tab.
//
// It must ALSO close every background tab the run opened for contact-info
// lookups. A run stopped mid-enrichment otherwise leaves invisible tabs the user
// never opened — the single worst failure mode in the enrichment path. State is
// cleared FIRST so the finish() calls below (and any late CONTACT_INFO) see a
// dead run and don't rewrite openedTabIds; then every pending lookup is aborted
// (enrich:false — a lookup cut short by Stop must not be recorded as "no contact
// info") to unblock its waiting run tab, and finally openedTabIds is swept as a
// belt-and-braces close of anything a pending entry didn't cover.
// Aborts every in-flight lookup and closes every contact-info tab a run opened.
// Shared by endRun (glint_run still readable, so its authoritative openedTabIds
// is used) and the STOPPED handler (glint_run already cleared by a self-stop, so
// only the in-memory mirror remains). Aborting with enrich:false is deliberate:
// a lookup cut short by a stop must not be recorded as "no contact info".
function sweepEnrichTabs(tabIds: Iterable<number>): void {
  const pendings = Array.from(pendingEnrich.values())
  pendingEnrich.clear()
  for (const p of pendings) p.finish(null, null, false)
  for (const id of tabIds) chrome.tabs.remove(id).catch(() => {})
  openedTabIdsMirror.clear()
}

async function endRun(): Promise<void> {
  const state = await getRunState()
  await clearRunState()
  if (state) clearBadge(state.tabId)
  // state.openedTabIds is authoritative when the run still exists; fall back to
  // the mirror only if it was already cleared (shouldn't happen on this path).
  sweepEnrichTabs(state ? state.openedTabIds : openedTabIdsMirror)
}

// Clears glint_run when it can no longer possibly be driven by any content
// script — an "orphaned" run. Nothing else ever clears a run except the
// tab closing (onRemoved) or the agent loop's own cap checks, both of which
// require a live content script on the run's own tab. Two ordinary paths
// destroy that content script without ever satisfying either: navigating the
// run tab off LinkedIn, and a browser restart (session restore reassigns tab
// ids, so the rebooted content script never matches state.tabId again). This
// reconciliation is the backstop for both.
//
// `navigatedTabId`, when provided (called from onUpdated), lets us skip the
// chrome.tabs.get round-trip for tabs that aren't the run's own tab — it is
// purely a fast-path filter, not a correctness requirement (reconcileRunState()
// re-derives everything from state.tabId regardless).
async function reconcileRunState(navigatedTabId?: number): Promise<void> {
  const state = await getRunState()
  if (!state?.active) return
  if (navigatedTabId !== undefined && navigatedTabId !== state.tabId) return

  // Backstop for the maxMinutes cap, which is otherwise enforced in nextAction
  // (called by runPageStep) — if no tab is running the page step anymore
  // (e.g. it was navigated away before the cap tripped), nothing else would
  // ever notice the run overstayed its limit.
  if (Date.now() - state.startedAt >= state.maxMinutes * 60_000) {
    console.debug("Glint: clearing orphaned run — time cap elapsed", state.tabId)
    await endRun()
    return
  }

  chrome.tabs.get(state.tabId, (tab) => {
    // Mirrors the existing onActivated handler's lastError/!tab check: the
    // tab no longer exists (closed in a way onRemoved raced with, or —
    // relevant here — replaced by a new tab id after a browser restart).
    if (chrome.runtime.lastError || !tab) {
      console.debug("Glint: clearing orphaned run — tab no longer exists", state.tabId)
      endRun()
      return
    }
    // The tab is alive but has genuinely navigated off LinkedIn, so no
    // content script can be running there. A LinkedIn URL — even mid-load,
    // backgrounded, or mid-SPA-navigation — is left alone; isLinkedIn() only
    // ever returns false for a real cross-origin navigation.
    if (!isLinkedIn(tab.url)) {
      console.debug(
        "Glint: clearing orphaned run — tab navigated away from LinkedIn",
        state.tabId,
        tab.url
      )
      endRun()
    }
  })
}

// Startup sweep for contact-info orphans. handleEnrich creates the tab and only
// then records its id (the id can't exist before create resolves — see the
// comment there), so a SW eviction or a browser crash inside that window strands
// a contact-info overlay tab with no owner to close it. On every SW start, find
// every contact-info overlay tab and close any the current run doesn't claim —
// all of them when there is no active run. Runs alongside reconcileRunState().
async function sweepContactInfoOrphans(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({
      url: "*://*.linkedin.com/in/*/overlay/contact-info/*",
    })
    const state = await getRunState()
    const claimed = new Set(state?.active ? state.openedTabIds : [])
    for (const tab of tabs) {
      if (tab.id !== undefined && !claimed.has(tab.id)) {
        chrome.tabs.remove(tab.id).catch(() => {})
      }
    }
  } catch (err) {
    console.debug("Glint: contact-info orphan sweep failed", err)
  }
}

async function startRun(
  query: string,
  tabId: number,
  maxPages: number,
  folderId: string | null
) {
  try {
    const parsed = await parseQuery(query)
    const url = buildSearchUrl(parsed)
    // Persist run state *before* navigating — the future content script
    // reads glint_run on load, so it must already be active by the time
    // the tab lands on the search results page.
    await setRunState({
      active: true,
      tabId,
      query,
      // Cached so page 2's URL costs no LLM call.
      parsed,
      startedAt: Date.now(),
      leadCount: 0,
      maxLeads: DEFAULT_MAX_LEADS,
      maxMinutes: DEFAULT_MAX_MINUTES,
      page: 1,
      maxPages,
      folderId,
      seen: [],
      enrichQueue: [],
      openedTabIds: [],
      phase: "scanning",
    })
    try {
      await chrome.tabs.update(tabId, { url })
    } catch (navErr) {
      // Navigation failed after we already marked the run active — don't
      // strand glint_run at active:true with nothing driving it. Cleanup is
      // wrapped so a rejection here can't mask the real NavigationError with
      // the generic fallback message below, re-stranding the run.
      try {
        await endRun()
      } catch (cleanupErr) {
        console.error("Glint: endRun failed after navigation error", cleanupErr)
      }
      throw new NavigationError(
        navErr instanceof Error ? navErr.message : "tabs.update failed"
      )
    }
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
            ? "Could not open LinkedIn in this tab. Try again."
            : err instanceof QueryServiceError
              ? "Search service is unavailable right now. Try again in a moment."
              : err instanceof NetworkError
                ? "Network error — check your connection and try again."
                : "Could not parse your request. Try again."
    sendMessage({ type: "RUN_ERROR", error })
  }
}

// Guards against a second START_RUN clobbering an in-flight run. The
// side panel's `running` flag can't be trusted for this: it's per-document,
// and a second window's side panel is an independently mounted document that
// has no idea another one already has a run active. glint_run is the only
// shared source of truth, so it's checked here before we ever call startRun.
async function handleStartRunMessage(
  query: string,
  maxPages: number,
  folderId: string | null
) {
  const state = await getRunState()
  if (state?.active) {
    sendMessage({
      type: "RUN_ERROR",
      error: "A search is already running. Stop it first.",
    })
    return
  }
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id !== undefined && isLinkedIn(tab.url)) {
      startRun(query, tab.id, maxPages, folderId)
    } else {
      sendMessage({
        type: "RUN_ERROR",
        error: "Open a LinkedIn tab to start a search.",
      })
    }
  })
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

    // Reconcile once at every service-worker startup. An MV3 SW is evicted
    // when idle and restarts often (on its own, and definitely across a
    // browser restart), so this runs naturally and regularly — it's what
    // catches a run left active after the browser itself was restarted with
    // glint_run still persisted (session restore gives the tab a new id, so
    // no content script will ever match state.tabId again).
    reconcileRunState()

    // Close any contact-info overlay tab a prior run left orphaned across this
    // SW restart (crash/eviction inside handleEnrich's create-then-record
    // window). Independent of reconcileRunState, which only handles the run's
    // OWN tab.
    sweepContactInfoOrphans()

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url !== undefined || changeInfo.status === "complete") {
        syncPanelForTab(tabId, tab.url)
      }
      // The "navigated away" trigger: only a URL change can turn a live,
      // on-LinkedIn run tab into an orphan, so that's the only changeInfo
      // that needs to re-check. navigatedTabId lets reconcileRunState()
      // skip its work for every tab update that isn't the run's own tab.
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

    // The side panel (the only UI that sends these messages) is a Chrome-only
    // entrypoint — see sidepanel/index.html's manifest.include and
    // wxt.config.ts's browser-conditional manifest — so this listener has no
    // sender on other targets. Scoping it here keeps that dependency honest
    // instead of registering a listener that can never receive a message.
    chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
      if (message.type === "START_RUN") {
        handleStartRunMessage(message.query, message.maxPages, message.folderId)
      } else if (message.type === "STOP_RUN") {
        endRun()
      } else if (message.type === "NAVIGATE") {
        // Only ever from the run's own tab, and only to a LinkedIn URL we built
        // ourselves. Both are checked: a content script is the least trusted
        // sender in the extension, and tabs.update is a navigation primitive.
        const tabId = sender.tab?.id
        if (tabId === undefined || !isLinkedIn(message.url)) return
        getRunState().then((state) => {
          if (state?.active && state.tabId === tabId) {
            chrome.tabs.update(tabId, { url: message.url }).catch((err) => {
              console.error("Glint: NAVIGATE failed", err)
              endRun()
            })
          }
        })
      } else if (message.type === "PROGRESS") {
        // Sent by the content script driving the run, so sender.tab IS the run's
        // own tab — no need to re-read glint_run to know which badge to paint.
        // The panel listens for this message too, independently.
        if (sender.tab?.id !== undefined) paintBadge(sender.tab.id, message.leadCount)
      } else if (message.type === "STOPPED") {
        // The agent loop stops itself (caps, commercial-limit banner, stale
        // rounds) by calling clearRunState() directly and announcing it here,
        // so this is the only place that learns the badge is now stale.
        if (sender.tab?.id !== undefined) clearBadge(sender.tab.id)
        // clearRunState already ran in the content script, so glint_run — and
        // its openedTabIds — is gone. Sweep the in-memory mirror instead, so a
        // contact-info tab a self-stop opened isn't stranded. Same abort-then-
        // close path endRun uses; the STOP_RUN branch above already covers the
        // user-initiated stop via endRun.
        sweepEnrichTabs(openedTabIdsMirror)
      } else if (message.type === "ENRICH") {
        // Async work, then sendResponse — return true (below) to hold the
        // channel open. handleEnrich validates the sender is the run's own tab.
        handleEnrich(message.leadId, message.url, sender.tab?.id, sendResponse)
        return true
      } else if (message.type === "CONTACT_INFO") {
        // The least-trusted sender in the extension. It is only honoured when it
        // comes from a tab THIS run opened for a lookup — i.e. one with a pending
        // entry. Anything else (a stray content script, a spoofed message) has
        // no entry and is silently dropped.
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
      // Only the run's OWN tab closing ends the run. A contact-info tab closing
      // (by us, or by the user) is expected — its pending lookup times out and
      // the run carries on. endRun (not clearRunState) so any other background
      // tabs this run opened are closed too, not stranded.
      if (state?.active && state.tabId === closedTabId) {
        await endRun()
      }
    })
  }
})
