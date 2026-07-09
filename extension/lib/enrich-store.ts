import type { EnrichBudget, EnrichPassState } from "@/lib/enrich-pass"

/**
 * chrome.storage.local accessors for the enrichment pass.
 *
 * Split from enrich-pass.ts so the decision logic there stays a pure module a
 * Vitest run can import without a browser. Same split, and same reason, as
 * agent-step.ts vs run.ts.
 */

const PASS_KEY = "glint_enrich_pass"
const BUDGET_KEY = "glint_enrich_budget"

export async function getEnrichPass(): Promise<EnrichPassState | null> {
  const res = await chrome.storage.local.get(PASS_KEY)
  return (res[PASS_KEY] as EnrichPassState) ?? null
}

export async function setEnrichPass(state: EnrichPassState): Promise<void> {
  await chrome.storage.local.set({ [PASS_KEY]: state })
}

export async function clearEnrichPass(): Promise<void> {
  await chrome.storage.local.remove(PASS_KEY)
}

export async function getEnrichBudget(): Promise<EnrichBudget | null> {
  const res = await chrome.storage.local.get(BUDGET_KEY)
  return (res[BUDGET_KEY] as EnrichBudget) ?? null
}

export async function setEnrichBudget(budget: EnrichBudget): Promise<void> {
  await chrome.storage.local.set({ [BUDGET_KEY]: budget })
}
