import { browser } from "wxt/browser"

const PANEL_KEY = "glint_panel"

/**
 * The panel's pre-run choices. Chrome unloads and remounts the side-panel
 * document every time it re-enables the panel for a tab, so anything held only
 * in React state is lost on a tab switch -- including a half-typed query and the
 * folder the user just picked.
 *
 * This is NOT the run. An active run lives in `glint_run` and rehydrates from
 * there; see getRunState().
 */
export type PanelState = {
  /** Run destination. `null` = Unfiled. Never `""` -- that is filter vocabulary. */
  destination: string | null
  /** True once the user has passed the folder picker. */
  destinationChosen: boolean
  /** The in-progress search query, so a tab switch does not discard it. */
  query: string
}

export const EMPTY_PANEL_STATE: PanelState = {
  destination: null,
  destinationChosen: false,
  query: "",
}

/**
 * Pure normalisation, split out from getPanelState() so it can be unit tested
 * without loading wxt/browser (which cannot load under Vitest). Mirrors how
 * agent-step.ts was split from run.ts.
 */
export function normalizePanelState(stored: unknown): PanelState {
  const s = (stored ?? null) as Partial<PanelState> | null
  if (!s) return EMPTY_PANEL_STATE
  return {
    // A `""` here would be filter vocabulary leaking into a destination, and the
    // server would reject it as an invalid folder. Coerce it to Unfiled.
    destination: typeof s.destination === "string" && s.destination.length > 0
      ? s.destination
      : null,
    destinationChosen: s.destinationChosen === true,
    query: typeof s.query === "string" ? s.query : "",
  }
}

export async function getPanelState(): Promise<PanelState> {
  const res = await browser.storage.local.get(PANEL_KEY)
  return normalizePanelState(res[PANEL_KEY])
}

export async function setPanelState(patch: Partial<PanelState>): Promise<void> {
  const current = await getPanelState()
  await browser.storage.local.set({ [PANEL_KEY]: { ...current, ...patch } })
}
