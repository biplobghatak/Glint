import type { StoredDraft } from "@/lib/draft"

// Deliberately plain DOM, not React. This module is bundled into the content
// script, which runs on EVERY linkedin.com page load. Pulling React in for one
// small card took the bundle from 14 kB to 215 kB — parsed on every page, for a
// card that appears on roughly one profile in fifty. The side panel keeps React;
// the content script does not get to.

// LinkedIn's message composer, when the user has opened it. Best-effort and
// fail-soft, like every other selector we point at their DOM: if none match, the
// Insert button stays disabled and the user copies instead. It never silently
// types into something that isn't a composer.
const COMPOSER_SELECTORS = [
  "div.msg-form__contenteditable[contenteditable='true']",
  "div.msg-form__msg-content-container div[contenteditable='true']",
  "form.msg-form div[role='textbox'][contenteditable='true']",
] as const

function findOpenComposer(): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector)
    // A composer that exists but is hidden (LinkedIn keeps overlay shells in the
    // DOM) is not an open composer.
    if (el && el.offsetParent !== null) return el
  }
  return null
}

/**
 * Inserts text into LinkedIn's own composer, as if the user had typed it.
 *
 * This function does not send anything, and nothing in this file does. There is
 * no .click() on a send button, no form.submit(), and no submit event dispatch.
 * Automated outbound messaging puts the *user's* LinkedIn account at risk (see
 * PLAN.md section 7 — ban risk is behavioral, not architectural), so the last
 * action is always a human pressing LinkedIn's own Send.
 */
function insertIntoComposer(composer: HTMLElement, text: string): void {
  composer.focus()
  // React-controlled contenteditables ignore direct textContent writes: the
  // framework's own state never learns about them and overwrites on next render.
  // execCommand routes through the browser's editing pipeline, so LinkedIn sees
  // the same input events a keystroke would produce.
  const inserted = document.execCommand("insertText", false, text)
  if (!inserted) {
    composer.textContent = text
    composer.dispatchEvent(new InputEvent("input", { bubbles: true }))
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** Builds the card and returns a teardown for whatever it left running. */
export function renderDraftCard(
  container: HTMLElement,
  draft: StoredDraft,
  onClose: () => void
): () => void {
  const card = el("div", "card")
  card.setAttribute("role", "dialog")
  card.setAttribute("aria-label", "Glint draft opener")

  const head = el("div", "head")
  head.append(
    el(
      "span",
      "title",
      draft.isFallback ? "Why they matched" : `Draft for ${draft.leadName}`
    )
  )
  const close = el("button", "close", "✕")
  close.type = "button"
  close.setAttribute("aria-label", "Dismiss")
  close.addEventListener("click", onClose)
  head.append(close)
  card.append(head)

  if (draft.isFallback) {
    card.append(
      el(
        "p",
        "fallback-note",
        "Couldn't write an opener just now — here are this lead's match reasons to work from."
      )
    )
  }

  card.append(el("div", "draft", draft.opener))

  const actions = el("div", "actions")

  const copy = el("button", "secondary", "Copy")
  copy.type = "button"
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(draft.opener)
      copy.textContent = "Copied"
      setTimeout(() => (copy.textContent = "Copy"), 1500)
    } catch {
      // Clipboard can be denied without a user gesture; the text is selectable
      // in the card either way.
    }
  })

  const insert = el("button", "primary", "Insert into composer")
  insert.type = "button"
  insert.addEventListener("click", () => {
    const composer = findOpenComposer()
    if (!composer) {
      syncComposerState()
      return
    }
    insertIntoComposer(composer, draft.opener)
    insert.textContent = "Inserted"
    setTimeout(() => (insert.textContent = "Insert into composer"), 1500)
  })

  actions.append(copy, insert)
  card.append(actions)

  // Insert stays disabled until LinkedIn's composer is actually open. Glint
  // never opens it, and never sends — the user reviews the text and presses
  // LinkedIn's own Send.
  const hint = el("p", "hint", "Open LinkedIn's message box first, then Insert.")
  card.append(hint)

  function syncComposerState() {
    const open = findOpenComposer() !== null
    insert.disabled = !open
    hint.style.display = open ? "none" : ""
  }
  syncComposerState()

  // The user almost always opens the composer *after* this card appears. Poll
  // rather than demand a reload — cheap, bounded to the card's lifetime, and off
  // LinkedIn's own event paths.
  const pollId = setInterval(syncComposerState, 700)

  container.append(card)
  return () => clearInterval(pollId)
}
