import { beforeEach, describe, expect, it } from "vitest"
import { applyTheme, DEFAULT_THEME } from "./theme"

describe("theme", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
  })

  it("defaults to light", () => {
    expect(DEFAULT_THEME).toBe("light")
  })

  it("stamps data-theme on the document element", () => {
    applyTheme("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    applyTheme("light")
    expect(document.documentElement.dataset.theme).toBe("light")
  })
})
