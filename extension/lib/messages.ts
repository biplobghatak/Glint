export type StartRunMessage = { type: "START_RUN"; query: string; maxPages: number }
export type StopRunMessage = { type: "STOP_RUN" }
// Sent by the content script when a results page is exhausted and another
// follows. The background owns tab navigation; see runPageStep's comment.
export type NavigateMessage = { type: "NAVIGATE"; url: string }
export type ProgressMessage = {
  type: "PROGRESS"
  leadCount: number
  status: string
}
export type StoppedMessage = { type: "STOPPED"; reason: string }
export type RunErrorMessage = { type: "RUN_ERROR"; error: string }
// Sent by a content script on startup to ask the background which tab it's
// running in, so it can compare against RunState.tabId and only drive the
// agent loop when it's actually the run's own tab. See WhichTabResponse
// below for the reply shape — it's not part of RuntimeMessage because it's
// never sent via chrome.runtime.sendMessage/onMessage as a standalone
// message, only as the sendResponse payload for this request.
export type WhichTabMessage = { type: "WHICH_TAB" }

export type RuntimeMessage =
  | StartRunMessage
  | StopRunMessage
  | NavigateMessage
  | ProgressMessage
  | StoppedMessage
  | RunErrorMessage
  | WhichTabMessage

// Response payload for WhichTabMessage, delivered via sendResponse(). Kept
// out of the RuntimeMessage union since it's never itself dispatched through
// onMessage as an incoming message.
export type WhichTabResponse = { tabId: number | null }
