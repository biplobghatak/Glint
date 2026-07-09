export type StartRunMessage = {
  type: "START_RUN"
  query: string
  maxPages: number
  /** Run destination. `null` means unfiled. Never `""`. */
  folderId: string | null
}
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
// Sent by the run's OWN tab, once per stored lead, to have the background open
// that lead's contact-info overlay in a background tab, extract email/phone, call
// enrich-lead, and close the tab. Request/response (the sender awaits
// EnrichResponse) so the run enriches leads serially — one background tab at a
// time. Ten simultaneous profile loads is a browsing pattern no human produces,
// so this must never fan out. `url` is the full contact-info overlay URL; the
// background re-checks it is a LinkedIn URL before navigating.
export type EnrichMessage = { type: "ENRICH"; leadId: string; url: string }
// Sent by the content script running ON a contact-info overlay tab, reporting
// what extractContactInfo() found (both null is a legitimate answer).
// Fire-and-forget: the background correlates it to the pending enrichment by the
// sender's tab id, which it validates is a tab THIS run actually opened — a
// content script is the least-trusted sender in the extension.
export type ContactInfoMessage = {
  type: "CONTACT_INFO"
  email: string | null
  phone: string | null
}

export type RuntimeMessage =
  | StartRunMessage
  | StopRunMessage
  | NavigateMessage
  | ProgressMessage
  | StoppedMessage
  | RunErrorMessage
  | WhichTabMessage
  | EnrichMessage
  | ContactInfoMessage

// Response payload for WhichTabMessage, delivered via sendResponse(). Kept
// out of the RuntimeMessage union since it's never itself dispatched through
// onMessage as an incoming message.
export type WhichTabResponse = { tabId: number | null }

// Response payload for EnrichMessage, delivered via sendResponse(). `done` is
// always true: the background has finished (enriched the lead and closed the
// tab, or given up on a timeout) by the time it replies. The run tab awaits it
// purely to pace the next lookup, never to learn what was found.
export type EnrichResponse = { done: true }

/**
 * Typed wrapper over chrome.runtime.sendMessage.
 *
 * chrome.runtime.sendMessage is declared `sendMessage<M = any>(message: M, …)`,
 * so M is inferred from the argument and never checked against RuntimeMessage.
 * Adding a required field to a message type therefore does NOT fail the build at
 * the senders — it fails silently at runtime. Every send must go through here.
 *
 * The rejection is swallowed on purpose: sending to a closed side panel or a
 * torn-down content script rejects with "Could not establish connection", which
 * is normal, not an error.
 */
export function sendRuntimeMessage(message: RuntimeMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {})
}
