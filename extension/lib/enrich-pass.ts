/**
 * The standalone contact-info enrichment pass.
 *
 * Enrichment used to ride inside a run: every stored lead got a background-tab
 * visit to its contact-info overlay, inline, between scoring a page and
 * paginating. That was affordable only because a run scanned one page and
 * stored at most ~10 leads. A deep run stores up to `maxLeads` (1000), and a
 * profile visit is the single most expensive thing Glint can do to a LinkedIn
 * account -- it is exactly what the commercial-use limit counts, and the
 * practitioner-safe ceiling is on the order of 50-100 profile views per DAY.
 * Inline enrichment on a deep run would spend 10-20x a safe daily budget in
 * under an hour.
 *
 * So the two are decoupled. Scanning a results page costs no profile view and
 * can go deep. Visiting a profile is metered here, by an explicit daily budget
 * the user spends deliberately.
 */

/** One lead to look up. `profilePath` is the `/in/<slug>` form. */
export type EnrichTarget = { leadId: string; profilePath: string }

/**
 * Persisted in chrome.storage.local, for the same reason RunState is: the
 * service worker driving this pass can be evicted between any two leads, and
 * `openedTabIds` must survive that eviction or a contact-info tab is stranded
 * with nothing that will ever close it.
 */
export type EnrichPassState = {
  active: boolean
  queue: EnrichTarget[]
  /** How many of `queue` have been attempted. Not how many succeeded. */
  index: number
  /** Contact-info tabs this pass opened. Every one must be closed when it ends. */
  openedTabIds: number[]
  startedAt: number
}

/**
 * Profile views per calendar day, across every pass.
 *
 * LinkedIn publishes no number and will not confirm one. 50 is the low end of
 * the range shipped by tools that have to live with the consequences (Dux-Soup
 * defaults to 50/day for free accounts). Deliberately conservative: the cost of
 * being wrong in one direction is a slower pass, and in the other a restricted
 * account.
 */
export const DAILY_PROFILE_VIEW_BUDGET = 50

/** Spend so far on one calendar day. Reset by rollover, never by a run ending. */
export type EnrichBudget = { day: string; used: number }

/**
 * Local calendar day, `YYYY-MM-DD`.
 *
 * Local, not UTC: the budget exists to model "how much has this human made
 * their account do today", and a UTC rollover would hand a user in UTC+13 a
 * fresh budget in the middle of their afternoon.
 */
export function dayKey(now: number): string {
  const d = new Date(now)
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** Views left today. A budget from an earlier day is spent-zero, not carried. */
export function remainingBudget(
  budget: EnrichBudget | null,
  now: number
): number {
  if (!budget || budget.day !== dayKey(now)) return DAILY_PROFILE_VIEW_BUDGET
  return Math.max(0, DAILY_PROFILE_VIEW_BUDGET - budget.used)
}

/** Records one spent view, rolling the day over if this is the first today. */
export function spendBudget(
  budget: EnrichBudget | null,
  now: number
): EnrichBudget {
  const day = dayKey(now)
  if (!budget || budget.day !== day) return { day, used: 1 }
  return { day, used: budget.used + 1 }
}

export type EnrichPassStep =
  | {
      kind: "enrich"
      index: number
      total: number
      leadId: string
      profilePath: string
      /** Panel line, e.g. "Looking up contact info… 2 of 12". */
      label: string
    }
  | { kind: "stop"; reason: string }
  | { kind: "done" }

/**
 * The pass's whole control flow, as a pure function of its state and the
 * remaining budget. The order of the checks is the contract:
 *
 * Stop outranks the budget, and the budget outranks the queue. A user who
 * clicked Stop must not see "daily limit reached" as the reason they stopped;
 * and an exhausted budget must halt the pass even with work left in the queue,
 * rather than reporting "done" as though every lead had been looked up.
 */
export function nextEnrichPassStep(
  state: EnrichPassState,
  budgetLeft: number
): EnrichPassStep {
  if (!state.active) return { kind: "stop", reason: "Stopped" }
  if (budgetLeft <= 0) {
    return {
      kind: "stop",
      reason: `Daily contact-info limit reached (${DAILY_PROFILE_VIEW_BUDGET}). Try again tomorrow.`,
    }
  }
  if (state.index >= state.queue.length) return { kind: "done" }
  const { leadId, profilePath } = state.queue[state.index]
  return {
    kind: "enrich",
    index: state.index,
    total: state.queue.length,
    leadId,
    profilePath,
    label: `Looking up contact info… ${state.index + 1} of ${state.queue.length}`,
  }
}
