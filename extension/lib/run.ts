import { browser } from "wxt/browser"
import type { ParsedQuery } from "@/lib/query"

const RUN_KEY = "glint_run"

export type RunPhase = "scanning" | "paginating"

/**
 * A run halts for four reasons and exactly one of them is a stop.
 *
 * - `user`   — the panel's or HUD's Pause.
 * - `hidden` — Chrome reported the run window `hidden` (minimized, fully
 *   occluded, or the screen locked). Pushing on would be pointless: a hidden
 *   page's timers are clamped to 1/second and, after five minutes hidden, to
 *   one wake-up per MINUTE, while rAF and IntersectionObserver stop firing —
 *   so LinkedIn's lazy result cards may never render at all. Auto-resumes.
 * - `tab_lost` — the run's tab or window was closed, discarded by Chrome's
 *   memory saver, or navigated off LinkedIn. Resume reopens it at the stored
 *   page. Not `tab_closed`: navigating away loses the tab to the run without
 *   closing it.
 * - `commercial_limit` — LinkedIn's own throttle. Resuming today will just hit
 *   it again; the state is kept so tomorrow's resume skips the pages already
 *   walked rather than re-spending the budget on them.
 */
export type PauseReason = "user" | "hidden" | "tab_lost" | "commercial_limit"

export type RunStatus = "running" | "paused"

export type RunState = {
  /**
   * `running` or `paused`. A run that has genuinely ended does not have a
   * status — it has no RunState at all, because the state is cleared. This was
   * a boolean `active` when the only two outcomes were "driving" and "gone";
   * a deep run adds a third, and pause is not a kind of stop.
   */
  status: RunStatus
  /** Only set while `status === "paused"`; `null` while running. */
  pauseReason: PauseReason | null
  tabId: number
  /**
   * The window Glint created for this run, so it can be focused, reopened, or
   * closed. A run owns its own window rather than hijacking the user's active
   * tab: the *selected tab of an unfocused, non-minimized window* reports
   * `visible`, which is the only state in which Chrome leaves a page's timers,
   * rAF, and IntersectionObserver alone. The user works in their own window and
   * the run is untouched. `null` for a run restored from a build that predates
   * the dedicated window, or one whose window we failed to create.
   */
  windowId: number | null
  query: string
  /** Cached at startRun so page N's URL never re-hits parse-search-query. */
  parsed: ParsedQuery
  startedAt: number
  /** Rows actually written. A scored-but-discarded lead does not count. */
  leadCount: number
  maxLeads: number
  /**
   * A runaway backstop, not the real bound. Depth is bounded by `maxLeads` and
   * `maxPages`; this only exists so a wedged run cannot outlive the browser
   * session. Do not tune it to shape a run's length.
   */
  maxMinutes: number
  /** 1-based LinkedIn results page. */
  page: number
  maxPages: number
  /**
   * Where this run files its leads. `null` means unfiled. This is a DESTINATION,
   * not a filter: LeadFilter.folderId's `""` sentinel ("unfiled") has no meaning
   * here and must never be assigned to it.
   */
  folderId: string | null
  /**
   * The site this run files its leads into, pinned at startRun. The panel's
   * active site can change mid-run; this must not. Every score-lead call resolves
   * its device_token from THIS id, so a switch cannot retarget leads already in
   * flight. `null` only for a run started by a build that had no sites.
   */
  siteId: string | null
  /**
   * Normalised profile paths already scored this run. An array, not a Set:
   * chrome.storage.local serialises to JSON. The content script rehydrates it
   * into a Set on load and writes it back as an array. This is the piece that
   * makes a run survive navigation -- without it, page 2's content script
   * would re-score everything it had already seen. It is also what makes a
   * PAUSE cheap: resuming re-reads `seen` and skips straight past every lead a
   * previous page already scored.
   */
  seen: string[]
  phase: RunPhase
}

/**
 * True when a run exists and is actively driving its tab.
 *
 * A type predicate, so the many `if (!isRunning(s)) return` guards narrow `s`
 * to a RunState for the rest of the scope instead of forcing a `!` on every
 * field access.
 */
export function isRunning(state: RunState | null | undefined): state is RunState {
  return state?.status === "running"
}

export async function getRunState(): Promise<RunState | null> {
  const res = await browser.storage.local.get(RUN_KEY)
  return (res[RUN_KEY] as RunState) ?? null
}

export async function setRunState(state: RunState): Promise<void> {
  await browser.storage.local.set({ [RUN_KEY]: state })
}

export async function clearRunState(): Promise<void> {
  await browser.storage.local.remove(RUN_KEY)
}
