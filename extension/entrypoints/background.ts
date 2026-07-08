function isLinkedIn(url: string | undefined): boolean {
  return !!url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//.test(url)
}

async function syncPanelForTab(tabId: number, url: string | undefined) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: isLinkedIn(url),
    })
  } catch {
    // tab may have closed mid-update; ignore
  }
}

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      syncPanelForTab(tabId, tab.url)
    }
  })

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => syncPanelForTab(tabId, tab.url))
  })
})
