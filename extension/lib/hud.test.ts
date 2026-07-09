import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHud } from "./hud"

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ""
  container = document.createElement("div")
  document.body.append(container)
})

describe("renderHud", () => {
  it("paints its initial model before any update", () => {
    renderHud(container, () => {})
    expect(container.textContent).toContain("Glint is searching")
    expect(container.textContent).toContain("page 1 of 1")
  })

  it("renders progress and updates it", () => {
    const hud = renderHud(container, () => {})
    hud.update({ leadCount: 14, page: 2, maxPages: 5, status: "Scoring Marta Ruiz…" })
    expect(container.textContent).toContain("14")
    expect(container.textContent).toContain("page 2 of 5")
    expect(container.textContent).toContain("Scoring Marta Ruiz…")
  })

  // A partial update must not reset the fields it omits -- the scan updates
  // `status` per card and `leadCount` only when a lead is newly inserted.
  it("merges a partial update instead of replacing the model", () => {
    const hud = renderHud(container, () => {})
    hud.update({ leadCount: 3, page: 2, maxPages: 5 })
    hud.update({ status: "Scoring Tom…" })
    expect(container.textContent).toContain("3")
    expect(container.textContent).toContain("page 2 of 5")
    expect(container.textContent).toContain("Scoring Tom…")
  })

  it("calls onStop when the stop button is clicked", () => {
    const onStop = vi.fn()
    renderHud(container, onStop)
    container.querySelector("button")!.click()
    expect(onStop).toHaveBeenCalledOnce()
  })

  it("empties the container on destroy", () => {
    const hud = renderHud(container, () => {})
    hud.destroy()
    expect(container.children).toHaveLength(0)
  })

  it("destroy is safe to call twice", () => {
    const hud = renderHud(container, () => {})
    hud.destroy()
    expect(() => hud.destroy()).not.toThrow()
  })

  // After destroy the run is over. A late update() from an unwinding scan loop
  // must not resurrect the HUD's DOM. destroy() detaches the card from
  // `container`, so asserting on container.textContent here would pass
  // trivially (the whole card, status text included, is gone regardless of
  // what update() does). Grab a live reference to the status node before
  // destroy() so the assertion actually observes whether update() still
  // writes into the (now-detached) DOM.
  it("ignores update after destroy", () => {
    const hud = renderHud(container, () => {})
    const statusEl = container.querySelector(".glint-hud-status")!
    hud.destroy()
    hud.update({ status: "late" })
    expect(statusEl.textContent).not.toContain("late")
  })
})
