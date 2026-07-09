import { describe, expect, it, vi } from "vitest"
import {
  findAddNoteButton,
  findConnectButton,
  findMoreButton,
  setReactTextareaValue,
} from "./connect"

describe("setReactTextareaValue", () => {
  // LinkedIn's textarea is React-controlled. `el.value = text` updates the DOM
  // node but NOT React's internal state, so the note posts empty. The write has
  // to go through the native value setter and then dispatch an input event,
  // which is what React's onChange actually listens to.
  it("writes through the native setter and dispatches an input event", () => {
    const el = document.createElement("textarea")
    const onInput = vi.fn()
    el.addEventListener("input", onInput)

    setReactTextareaValue(el, "Hi Sarah, open to a chat?")

    expect(el.value).toBe("Hi Sarah, open to a chat?")
    expect(onInput).toHaveBeenCalledOnce()
    expect(onInput.mock.calls[0][0].bubbles).toBe(true)
  })

  it("overwrites existing text rather than appending", () => {
    const el = document.createElement("textarea")
    setReactTextareaValue(el, "first")
    setReactTextareaValue(el, "second")
    expect(el.value).toBe("second")
  })
})

describe("findConnectButton", () => {
  function root(html: string): ParentNode {
    const el = document.createElement("div")
    el.innerHTML = html
    return el
  }

  it("finds a top-level Connect button by aria-label", () => {
    const r = root(`<button aria-label="Invite Jane Doe to connect">Connect</button>`)
    expect(findConnectButton(r)).not.toBeNull()
  })

  // LinkedIn frequently hides Connect behind a "More" overflow menu. Both paths
  // are required; a fallback comment is not a code path.
  it("finds a Connect item inside the More overflow menu", () => {
    const r = root(
      `<div class="artdeco-dropdown__content"><button aria-label="Invite Jane Doe to connect">Connect</button></div>`
    )
    expect(findConnectButton(r)).not.toBeNull()
  })

  it("ignores a disabled Connect button", () => {
    const r = root(`<button disabled aria-label="Invite Jane to connect">Connect</button>`)
    expect(findConnectButton(r)).toBeNull()
  })

  it("returns null when there is no Connect button", () => {
    expect(findConnectButton(root(`<button>Message</button>`))).toBeNull()
  })

  // The likely reason the dialog never opened in practice: LinkedIn renders the
  // items inside its "More" overflow as div[role="button"], not <button>, so a
  // querySelector("button[...]") could never see them -- and the overflow is
  // where Connect lives on most 3rd-degree profiles.
  it("finds a Connect item rendered as div[role=button] in the overflow", () => {
    const r = root(
      `<div class="artdeco-dropdown__content">` +
        `<div role="button" aria-label="Invite Jane Doe to connect">Connect</div></div>`
    )
    expect(findConnectButton(r)).not.toBeNull()
  })

  it("finds a Connect control by its visible text when aria-label is absent", () => {
    expect(findConnectButton(root(`<button>Connect</button>`))).not.toBeNull()
  })

  it("ignores an aria-disabled control", () => {
    const r = root(`<div role="button" aria-disabled="true">Connect</div>`)
    expect(findConnectButton(r)).toBeNull()
  })

  // A substring match on "connect" would click any of these and navigate the
  // user off the profile.
  it("does not match neighbouring controls that merely contain the word", () => {
    const r = root(
      `<button>Connections</button>` +
        `<button>Connect with more people</button>` +
        `<a role="button">Manage my network</a>`
    )
    expect(findConnectButton(r)).toBeNull()
  })
})

describe("findMoreButton", () => {
  it("matches the overflow trigger by aria-label or text", () => {
    const r = (html: string) => {
      const el = document.createElement("div")
      el.innerHTML = html
      return el
    }
    expect(findMoreButton(r(`<button aria-label="More actions">…</button>`))).not.toBeNull()
    expect(findMoreButton(r(`<button>More</button>`))).not.toBeNull()
    // "More" as a prefix of something else is a different control.
    expect(findMoreButton(r(`<button>More profiles for you</button>`))).toBeNull()
  })
})

describe("findAddNoteButton", () => {
  it("matches Add a note, and nothing else", () => {
    const r = (html: string) => {
      const el = document.createElement("div")
      el.innerHTML = html
      return el
    }
    expect(findAddNoteButton(r(`<button>Add a note</button>`))).not.toBeNull()
    expect(findAddNoteButton(r(`<button aria-label="Add a note">+</button>`))).not.toBeNull()
    expect(findAddNoteButton(r(`<button>Send without a note</button>`))).toBeNull()
  })
})
