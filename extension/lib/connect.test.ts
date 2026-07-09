import { describe, expect, it, vi } from "vitest"
import { findConnectButton, setReactTextareaValue } from "./connect"

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
})
