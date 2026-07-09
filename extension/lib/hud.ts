/**
 * Custom-element name for the HUD's shadow host. Task 8 passes it to
 * createShadowRootUi(), and isGlintNode() must recognise it: the content
 * script's MutationObserver watches document.body with subtree:true, so a
 * HUD element it does not recognise as its own would retrigger the scan that
 * mounted it.
 */
export const HUD_TAG = "glint-hud"

export type HudModel = {
  leadCount: number
  page: number
  maxPages: number
  status: string
}

export type HudHandle = {
  update(patch: Partial<HudModel>): void
  destroy(): void
}

const INITIAL: HudModel = { leadCount: 0, page: 1, maxPages: 1, status: "Starting…" }

/**
 * Renders the run HUD into an already-created container.
 *
 * Takes a container rather than creating its own shadow root, mirroring
 * renderDraftCard(): createShadowRootUi() owns the shadow root, and this stays
 * a pure DOM function that a test can drive with a plain <div>. Its styles live
 * in entrypoints/linkedin.content/style.css, which cssInjectionMode:"ui" hands
 * to the shadow root instead of injecting into LinkedIn's document.
 */
export function renderHud(container: HTMLElement, onStop: () => void): HudHandle {
  const model: HudModel = { ...INITIAL }
  let live = true

  const card = document.createElement("div")
  card.className = "glint-hud-card"
  card.innerHTML = `
    <div class="glint-hud-top">
      <span class="glint-hud-dot"></span>
      <span class="glint-hud-title">Glint is searching</span>
    </div>
    <div class="glint-hud-count"></div>
    <div class="glint-hud-muted">leads scored · <span class="glint-hud-pages"></span></div>
    <div class="glint-hud-status"></div>
    <button type="button" class="glint-hud-stop">Stop</button>
  `

  const countEl = card.querySelector(".glint-hud-count") as HTMLElement
  const pagesEl = card.querySelector(".glint-hud-pages") as HTMLElement
  const statusEl = card.querySelector(".glint-hud-status") as HTMLElement
  const stopEl = card.querySelector("button") as HTMLButtonElement

  stopEl.addEventListener("click", () => onStop())
  container.append(card)

  function paint() {
    countEl.textContent = String(model.leadCount)
    pagesEl.textContent = `page ${model.page} of ${model.maxPages}`
    statusEl.textContent = model.status
    statusEl.title = model.status
  }
  paint()

  return {
    update(patch) {
      // The scan loop can be mid-await when the run ends and destroy() fires.
      // A late update must not repaint a HUD the user has already seen vanish.
      if (!live) return
      Object.assign(model, patch)
      paint()
    },
    destroy() {
      // Safe twice: a run can end from a cap and from a Stop click.
      if (!live) return
      live = false
      card.remove()
    },
  }
}
