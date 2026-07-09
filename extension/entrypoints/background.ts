import { isLinkedIn } from "@/lib/linkedin"
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError, QueryServiceError, NetworkError } from "@/lib/query"
import { getRunState, setRunState, clearRunState } from "@/lib/run"
import type { RuntimeMessage, WhichTabResponse } from "@/lib/messages"

const DEFAULT_MAX_LEADS = 100
const DEFAULT_MAX_MINUTES = 20

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
  chrome.runtime.sendMessage(message).catch(() => {})
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

// Every path that ends a run must also clear that run's badge, and the badge is
// keyed by the run's own tab id — which is only knowable from glint_run. Reading
// it before clearing is therefore not an optimization; skipping it strands a
// stale count on the toolbar for the life of the tab.
async function endRun(): Promise<void> {
  const state = await getRunState()
  await clearRunState()
  if (state) clearBadge(state.tabId)
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
      if (state?.active && state.tabId === closedTabId) {
        await clearRunState()
      }
    })
  }
})
