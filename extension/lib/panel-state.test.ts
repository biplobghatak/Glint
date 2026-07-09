import { describe, expect, it } from "vitest"
import { EMPTY_PANEL_STATE, normalizePanelState } from "./panel-state"

describe("normalizePanelState", () => {
  it("returns EMPTY_PANEL_STATE for an empty store", () => {
    expect(normalizePanelState(undefined)).toEqual(EMPTY_PANEL_STATE)
    expect(normalizePanelState(null)).toEqual(EMPTY_PANEL_STATE)
  })

  it("coerces a stored empty-string destination to null", () => {
    expect(
      normalizePanelState({ destination: "", destinationChosen: true, query: "ceo" })
    ).toEqual({ destination: null, destinationChosen: true, query: "ceo", ownWindow: false })
  })

  it("lets a stored uuid destination survive", () => {
    const uuid = "3f9a2b1c-1111-4a2b-9c3d-abcdef123456"
    expect(
      normalizePanelState({ destination: uuid, destinationChosen: true, query: "" })
    ).toEqual({ destination: uuid, destinationChosen: true, query: "", ownWindow: false })
  })

  // A state written before ownWindow existed has no such key, and `undefined`
  // must read as "run in this tab" — the default the panel ships with.
  it("defaults ownWindow to false and only accepts a real true", () => {
    expect(normalizePanelState({ query: "x" }).ownWindow).toBe(false)
    expect(normalizePanelState({ ownWindow: "yes" }).ownWindow).toBe(false)
    expect(normalizePanelState({ ownWindow: true }).ownWindow).toBe(true)
  })
})
