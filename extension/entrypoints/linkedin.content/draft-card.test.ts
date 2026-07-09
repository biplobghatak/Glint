import { describe, expect, it } from "vitest"
import { displayName, renderDraftCard } from "./draft-card"
import type { ConnectOutcome } from "@/lib/connect"
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

function render(draft: StoredDraft, outcome: ConnectOutcome) {
  const container = document.createElement("div")
  const teardown = renderDraftCard(container, draft, outcome, () => {})
  return { container, teardown }
}

describe("renderDraftCard", () => {
  it("prefilled: tells the user to press LinkedIn's own Send and offers no composer insert", () => {
    const { container, teardown } = render(makeDraft(), "filled")
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
    const { container, teardown } = render(makeDraft(), "no_textarea")
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
    for (const outcome of ["filled", "no_button", "no_note_option", "no_textarea"] as const) {
      const { container, teardown } = render(makeDraft(), outcome)
      // No submit button, and no button whose label reads as an outbound send.
      expect(container.querySelector('button[type="submit"]')).toBeNull()
      const labels = Array.from(container.querySelectorAll("button")).map((b) =>
        (b.textContent ?? "").toLowerCase()
      )
      expect(labels.some((l) => l.includes("send"))).toBe(false)
      teardown()
    }
  })

  // The old card said "Couldn't open LinkedIn's connect dialog" for every
  // failure, including the two that are not failures of ours at all.
  it("names the actual reason the note could not be prefilled", () => {
    const missing = render(makeDraft(), "no_button")
    expect(missing.container.textContent).toContain("No Connect button on this profile")
    missing.teardown()

    const quota = render(makeDraft(), "no_note_option")
    expect(quota.container.textContent).toContain("limited number of noted invites")
    quota.teardown()
  })

  it("renders a long or malformed stored name as a name, not a paragraph", () => {
    const blob =
      "Ritu David Ritu David Clarity Catalyst for Global Leaders & Brands | " +
      "Founder, The Data DuckMumbai, Maharashtra, India17K followers"
    const { container, teardown } = render(makeDraft({ leadName: blob }), "filled")
    const title = container.querySelector(".title") as HTMLElement
    expect(title.textContent).toBe("Draft for Ritu David Ritu David Clarity Catalyst…")
    // The untruncated value stays reachable rather than being destroyed.
    expect(title.title).toBe(blob)
    teardown()
  })
})

describe("displayName", () => {
  it("passes an ordinary name through untouched", () => {
    expect(displayName("Jane Doe")).toBe("Jane Doe")
  })

  it("cuts at the first structural separator", () => {
    expect(displayName("Jane Doe | Founder, Acme")).toBe("Jane Doe")
    expect(displayName("Jane Doe • 2nd")).toBe("Jane Doe")
  })

  it("ellipsizes a long single-line name", () => {
    expect(displayName("a".repeat(50))).toBe("a".repeat(39) + "…")
  })
})
