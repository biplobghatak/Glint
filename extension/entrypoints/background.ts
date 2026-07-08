import { isLinkedIn } from "@/lib/linkedin"

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
  }
})
