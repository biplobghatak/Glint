import { describe, expect, it } from "vitest"
import { renderDraftCard } from "./draft-card"
import type { StoredDraft } from "@/lib/draft"

function makeDraft(over: Partial<StoredDraft> = {}): StoredDraft {
  return {
    profilePath: "/in/jane-doe",
    opener: "Hi Jane, open to a quick chat about hiring?",
    leadName: "Jane Doe",
    createdAt: Date.now(),
    isFallback: false,
    ...over,
  }
}

function render(draft: StoredDraft, prefilled: boolean) {
  const container = document.createElement("div")
  const teardown = renderDraftCard(container, draft, prefilled, () => {})
  return { container, teardown }
}

describe("renderDraftCard", () => {
  it("prefilled: tells the user to press LinkedIn's own Send and offers no composer insert", () => {
    const { container, teardown } = render(makeDraft(), true)
    const text = container.textContent ?? ""

    expect(text).toContain("filled into LinkedIn's connect box")
    expect(text).toContain("press LinkedIn's Send")
    // No insert-into-composer affordance when the note is already in the box.
    const buttons = Array.from(container.querySelectorAll("button")).map(
      (b) => b.textContent
    )
    expect(buttons).not.toContain("Insert into composer")
    // Copy is still offered.
    expect(buttons).toContain("Copy")
    teardown()
  })

  it("not prefilled: falls back to copy + insert and says the dialog couldn't be opened", () => {
    const { container, teardown } = render(makeDraft(), false)
    const text = container.textContent ?? ""

    expect(text).toContain("Couldn't open LinkedIn's connect dialog")
    const buttons = Array.from(container.querySelectorAll("button")).map(
      (b) => b.textContent
    )
    expect(buttons).toContain("Insert into composer")
    expect(buttons).toContain("Copy")
    teardown()
  })

  it("never renders a submit control in either state — Glint never clicks LinkedIn's Send", () => {
    for (const prefilled of [true, false]) {
      const { container, teardown } = render(makeDraft(), prefilled)
      // No submit button, and no button whose label reads as an outbound send.
      expect(container.querySelector('button[type="submit"]')).toBeNull()
      const labels = Array.from(container.querySelectorAll("button")).map((b) =>
        (b.textContent ?? "").toLowerCase()
      )
      expect(labels.some((l) => l.includes("send"))).toBe(false)
      teardown()
    }
  })
})
