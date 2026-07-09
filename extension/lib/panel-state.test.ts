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
    ).toEqual({ destination: null, destinationChosen: true, query: "ceo" })
  })

  it("lets a stored uuid destination survive", () => {
    const uuid = "3f9a2b1c-1111-4a2b-9c3d-abcdef123456"
    expect(
      normalizePanelState({ destination: uuid, destinationChosen: true, query: "" })
    ).toEqual({ destination: uuid, destinationChosen: true, query: "" })
  })

  // A key from a build that has since removed it must not survive into the
  // normalized shape, or it reappears on the next setPanelState() merge.
  it("drops keys it does not know about", () => {
    expect(normalizePanelState({ query: "x", ownWindow: true })).toEqual({
      destination: null,
      destinationChosen: false,
      query: "x",
    })
  })
})
