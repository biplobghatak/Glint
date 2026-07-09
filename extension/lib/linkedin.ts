export function isLinkedIn(url: string | undefined): boolean {
  return !!url && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//.test(url)
}

/**
 * A tab that exists but has not committed a real navigation yet.
 *
 * The run's window is created on `about:blank` so that glint_run can be written
 * before any content script loads and reads it. Chrome fires `tabs.onUpdated`
 * for that `about:blank` commit, and that event can land AFTER the state write
 * but BEFORE the search URL is applied. `isLinkedIn("about:blank")` is false, so
 * without this distinction the reconciler reads a brand-new run window as a run
 * tab that navigated off LinkedIn and pauses the run one instant before its
 * results page arrives.
 *
 * "Not LinkedIn" and "not anywhere yet" are different facts. Only the first is
 * evidence that a run lost its tab.
 */
export function isPreNavigation(url: string | undefined): boolean {
  return !url || url === "about:blank" || url === "chrome://newtab/"
}
