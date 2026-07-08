import { isLinkedIn } from "@/lib/linkedin"
import { parseQuery, buildSearchUrl, UnpairedError, NoIcpError } from "@/lib/query"
import { getRunState, setRunState, clearRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

const DEFAULT_MAX_LEADS = 100
const DEFAULT_MAX_MINUTES = 20

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
    await setRunState({
      active: true,
      tabId,
      query,
      startedAt: Date.now(),
      leadCount: 0,
      maxLeads: DEFAULT_MAX_LEADS,
      maxMinutes: DEFAULT_MAX_MINUTES,
    })
    await chrome.tabs.update(tabId, { url })
  } catch (err) {
    const error =
      err instanceof UnpairedError
        ? "Not paired. Open the popup and pair first."
        : err instanceof NoIcpError
          ? "No ICP found. Complete onboarding in the web app first."
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
          if (tab?.id) startRun(message.query, tab.id)
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
