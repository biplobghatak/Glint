import { browser } from "wxt/browser"
import type { ParsedQuery } from "@/lib/query"

const RUN_KEY = "glint_run"

export type RunPhase = "scanning" | "paginating"

export type RunState = {
  active: boolean
  tabId: number
  query: string
  /** Cached at startRun so page N's URL never re-hits parse-search-query. */
  parsed: ParsedQuery
  startedAt: number
  /** Rows actually written. A scored-but-discarded lead does not count. */
  leadCount: number
  maxLeads: number
  maxMinutes: number
  /** 1-based LinkedIn results page. */
  page: number
  maxPages: number
  /**
   * Normalised profile paths already scored this run. An array, not a Set:
   * chrome.storage.local serialises to JSON. The content script rehydrates it
   * into a Set on load and writes it back as an array. This is the piece that
   * makes a run survive navigation -- without it, page 2's content script
   * would re-score everything it had already seen.
   */
  seen: string[]
  phase: RunPhase
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
