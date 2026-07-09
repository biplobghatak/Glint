import { browser } from "wxt/browser"
import type { ParsedQuery } from "@/lib/query"

const RUN_KEY = "glint_run"

export type RunPhase = "scanning" | "enriching" | "paginating"

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
   * would re-score everything it had already seen.
   */
  seen: string[]
  /**
   * Leads STORED on the current page that still need a contact-info visit.
   * Populated during the card loop (one entry per `result.inserted` lead), drained
   * by the enrichment pass, then emptied before pagination. Persisted like `seen`
   * because it rides through chrome.storage.local as JSON.
   */
  enrichQueue: { leadId: string; profilePath: string }[]
  /**
   * Background tabs this run opened for contact-info lookups. Every one MUST be
   * closed when the run ends — the background owns tab lifecycle, so endRun()
   * reads this and closes each. A run stopped mid-enrichment otherwise strands
   * invisible tabs the user never opened. This is the worst failure mode in the
   * enrichment path, so the list lives in persisted state, not memory: it must
   * survive a service-worker eviction between opening a tab and closing it.
   */
  openedTabIds: number[]
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
