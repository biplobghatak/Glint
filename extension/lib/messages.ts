import type { EnrichTarget } from "@/lib/enrich-pass"
import type { PauseReason } from "@/lib/run"

export type StartRunMessage = {
  type: "START_RUN"
  query: string
  maxPages: number
  /** Run destination. `null` means unfiled. Never `""`. */
  folderId: string | null
  /**
   * The tab the run should drive: the one the side panel is attached to, which
   * the panel resolves for itself (a side panel has no `sender.tab`). `null`
   * when it could not be resolved.
   *
   * A request, not an instruction. The background re-checks that the tab exists
   * and is on LinkedIn before adopting it, and opens its own window if not — it
   * is about to hand this id to chrome.tabs.update, and a navigation primitive
   * does not take a tab id on trust.
   *
   * Ignored entirely when `ownWindow` is true.
   */
  tabId: number | null
  /**
   * Drive a window of Glint's own instead of `tabId`. The user's escape hatch
   * for "I want to keep browsing while it runs": a hidden tab is throttled, but
   * the selected tab of an unfocused window is not. See PanelState.ownWindow.
   */
  ownWindow: boolean
}
export type StopRunMessage = { type: "STOP_RUN" }
// A run halts for four reasons and only one of them is a stop. Pause keeps
// glint_run — `page` and `seen` above all — so resuming continues at the next
// page without rescoring, and without re-spending commercial-use budget on
// pages already walked. Sent by the panel (user), and by the background when
// the run window is hidden or its tab closes.
export type PauseRunMessage = { type: "PAUSE_RUN"; reason: PauseReason }
export type ResumeRunMessage = { type: "RESUME_RUN" }
// Sent by the content script when a results page is exhausted and another
// follows. The background owns tab navigation; see runPageStep's comment.
export type NavigateMessage = { type: "NAVIGATE"; url: string }
export type ProgressMessage = {
  type: "PROGRESS"
  leadCount: number
  status: string
}
// Distinct from STOPPED: the run is still in storage and still resumable. The
// panel must render a Resume affordance, not an ended run.
export type PausedMessage = {
  type: "PAUSED"
  reason: PauseReason
  /** Human-facing line, e.g. "Paused — keep the Glint window visible." */
  message: string
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
// Sent by the SIDE PANEL to begin a standalone contact-info pass over leads the
// user picked. Not sent by a run: visiting a profile is the one action that
// spends LinkedIn's commercial-use budget, so it is never a side effect of
// scanning. See lib/enrich-pass.ts. The background owns the whole pass — it
// opens one background tab at a time, extracts, enriches, closes, and paces.
// Ten simultaneous profile loads is a browsing pattern no human produces, so
// this must never fan out.
export type StartEnrichMessage = {
  type: "START_ENRICH"
  targets: EnrichTarget[]
}
export type StopEnrichMessage = { type: "STOP_ENRICH" }
// Broadcast by the background as the pass walks its queue, for the panel.
export type EnrichProgressMessage = {
  type: "ENRICH_PROGRESS"
  done: number
  total: number
  status: string
}
// Broadcast once, when the pass ends for any reason (drained, Stop, or the
// daily profile-view budget). `enriched` counts lookups actually attempted.
export type EnrichStoppedMessage = {
  type: "ENRICH_STOPPED"
  reason: string
  enriched: number
}
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
// Sent by the background to ANY LinkedIn content script, asking it to fetch a
// contact-info overlay same-origin and parse it. The content script is the only
// place this can happen: DOMParser does not exist in an MV3 service worker, and
// a same-origin fetch carries the session cookie without Glint ever touching a
// credential. Answers with ContactInfoResult; `readable: false` sends the
// background back to the slower, visible, tab-based lookup.
export type FetchContactInfoMessage = {
  type: "FETCH_CONTACT_INFO"
  url: string
}

export type RuntimeMessage =
  | StartRunMessage
  | StopRunMessage
  | PauseRunMessage
  | ResumeRunMessage
  | NavigateMessage
  | ProgressMessage
  | PausedMessage
  | StoppedMessage
  | RunErrorMessage
  | WhichTabMessage
  | StartEnrichMessage
  | StopEnrichMessage
  | EnrichProgressMessage
  | EnrichStoppedMessage
  | ContactInfoMessage
  | FetchContactInfoMessage

// Response payload for WhichTabMessage, delivered via sendResponse(). Kept
// out of the RuntimeMessage union since it's never itself dispatched through
// onMessage as an incoming message.
export type WhichTabResponse = { tabId: number | null }

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
