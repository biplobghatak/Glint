import { browser } from "wxt/browser"

const RUN_KEY = "glint_run"

export type RunState = {
  active: boolean
  tabId: number
  query: string
  startedAt: number
  leadCount: number
  maxLeads: number
  maxMinutes: number
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
