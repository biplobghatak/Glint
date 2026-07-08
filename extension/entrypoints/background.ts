import { isLinkedIn } from "@/lib/linkedin"
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError, QueryServiceError } from "@/lib/query"
import { getRunState, setRunState, clearRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

const DEFAULT_MAX_LEADS = 100
const DEFAULT_MAX_MINUTES = 20

// Thrown when the run state was persisted successfully but navigating the
// tab to the search URL failed (blocked/disallowed navigation, discarded
// tab, restricted page, etc). Kept distinct from parse/transport failures so
// startRun's catch can report an accurate, non-misleading message.
class NavigationError extends Error {}

async function syncPanelForTab(tabId: number, url: string | undefined) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isLinkedIn(url),
    })
  } catch (err) {
    // tab may have closed mid-update; ignore, but keep it visible
    console.debug("Glint: syncPanelForTab failed", tabId, err)
  }
}

function sendMessage(message: RuntimeMessage) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function startRun(query: string, tabId: number) {
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
      startedAt: Date.now(),
      leadCount: 0,
      maxLeads: DEFAULT_MAX_LEADS,
      maxMinutes: DEFAULT_MAX_MINUTES,
    })
    try {
      await chrome.tabs.update(tabId, { url })
    } catch (navErr) {
      // Navigation failed after we already marked the run active — don't
      // strand glint_run at active:true with nothing driving it.
      await clearRunState()
      throw new NavigationError(
        navErr instanceof Error ? navErr.message : "tabs.update failed"
      )
    }
  } catch (err) {
    const error =
      err instanceof UnpairedError
        ? "Not paired. Open the popup and pair first."
        : err instanceof NoIcpError
          ? "No ICP found. Complete onboarding in the web app first."
          : err instanceof NavigationError
            ? "Could not open LinkedIn in this tab. Try again."
            : err instanceof QueryServiceError
              ? "Search service is unavailable right now. Try again in a moment."
              : err instanceof TypeError
                ? "Network error — check your connection and try again."
                : "Could not parse your request. Try again."
    sendMessage({ type: "RUN_ERROR", error })
  }
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

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url !== undefined || changeInfo.status === "complete") {
        syncPanelForTab(tabId, tab.url)
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
    chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === "START_RUN") {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (tab?.id !== undefined && isLinkedIn(tab.url)) {
            startRun(message.query, tab.id)
          } else {
            sendMessage({
              type: "RUN_ERROR",
              error: "Open a LinkedIn tab to start a search.",
            })
          }
        })
      } else if (message.type === "STOP_RUN") {
        clearRunState()
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
