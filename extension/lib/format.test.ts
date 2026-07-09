import { describe, expect, it } from "vitest"
import { formatScore } from "./format"

describe("formatScore", () => {
  it.each([
    [85, "8.5"],
    [65, "6.5"],
    [100, "10.0"],
    [0, "0.0"],
    [7, "0.7"],
    [99, "9.9"],
  ])("renders stored %i as %s", (stored, shown) => {
    expect(formatScore(stored)).toBe(shown)
  })

  // 0-100 is the storage scale and 0-10 is the display scale. A caller that
  // passes an already-divided value is a bug we want loud, not rounded away.
  it("does not clamp out-of-range input", () => {
    expect(formatScore(140)).toBe("14.0")
  })
})
