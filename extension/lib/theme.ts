import { browser } from "wxt/browser"

export type Theme = "light" | "dark"

const THEME_KEY = "glint_theme"

/** Light, not "follow the OS". The extension is a light-mode product. */
export const DEFAULT_THEME: Theme = "light"

/**
 * Stamps the theme where CSS can see it. `:root[data-theme="dark"]` in
 * styles/theme.css is the only selector that reacts, so one attribute drives
 * the side panel, the popup, and the content script's HUD shadow root alike.
 *
 * Synchronous on purpose: main.tsx calls it before first paint, and an awaited
 * storage read there would flash the wrong theme.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export async function getTheme(): Promise<Theme> {
  const res = await browser.storage.local.get(THEME_KEY)
  return res[THEME_KEY] === "dark" ? "dark" : DEFAULT_THEME
}

export async function setTheme(theme: Theme): Promise<void> {
  await browser.storage.local.set({ [THEME_KEY]: theme })
  applyTheme(theme)
}
