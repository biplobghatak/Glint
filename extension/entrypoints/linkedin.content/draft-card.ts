import type { ConnectOutcome } from "@/lib/connect"
import type { StoredDraft } from "@/lib/draft"

/**
 * A heading-safe rendering of a lead's stored name.
 *
 * Names are extracted from LinkedIn's DOM and guarded at extraction, but rows
 * stored before that guard existed can hold a whole profile top-card — headline,
 * location, follower count and all. The card must not render a paragraph where a
 * name belongs, and CSS clamping alone would still hand the whole blob to a
 * screen reader.
 */
export function displayName(raw: string): string {
  const first = raw.split(/[\n|•]/)[0]?.trim() ?? ""
  const name = first.length > 0 ? first : raw.trim()
  return name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name
}

/** What to tell the user when the note could not be prefilled. */
function fallbackReason(outcome: ConnectOutcome): string {
  switch (outcome) {
    case "no_button":
      return "No Connect button on this profile — you may already be connected, or an invite is pending. Copy the note instead."
    case "no_note_option":
      return "LinkedIn didn't offer a note field. Free accounts get a limited number of noted invites each month. Copy the note instead."
    case "no_textarea":
      return "Couldn't open LinkedIn's connect dialog — copy the note instead."
    case "filled":
      return ""
  }
}

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

/**
 * Builds the card and returns a teardown for whatever it left running.
 *
 * `prefilled` is the outcome of openConnectAndFill() upstream:
 *  - true  — the opener is already sitting in LinkedIn's Connect note box. The
 *            card just asks the user to review it and press LinkedIn's own Send.
 *            No composer affordance is shown; there is nothing to insert.
 *  - false — the Connect dialog couldn't be opened (no button, or no textarea).
 *            The card falls back to the copy + insert-into-composer flow, and
 *            says so.
 *
 * Either way Glint never sends: the last action is always a human pressing
 * LinkedIn's own Send. Plain DOM — this module runs in the content script and
 * must never pull React in.
 */
export function renderDraftCard(
  container: HTMLElement,
  draft: StoredDraft,
  outcome: ConnectOutcome,
  onClose: () => void
): () => void {
  const prefilled = outcome === "filled"
  const card = el("div", "card")
  card.setAttribute("role", "dialog")
  card.setAttribute("aria-label", "Glint draft opener")

  const head = el("div", "head")
  const title = el(
    "span",
    "title",
    draft.isFallback ? "Why they matched" : `Draft for ${displayName(draft.leadName)}`
  )
  // The full value stays reachable on hover even when the heading clamps it.
  title.title = draft.leadName
  head.append(title)
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
  actions.append(copy)

  // The note is already in LinkedIn's Connect box. Nothing to insert — tell the
  // user to review and press LinkedIn's own Send, and stop. No composer poll.
  if (prefilled) {
    card.append(actions)
    card.append(
      el(
        "p",
        "hint",
        "Your note is filled into LinkedIn's connect box. Review it and press LinkedIn's Send."
      )
    )
    container.append(card)
    return () => {}
  }

  // Fallback: the Connect dialog couldn't be opened. Copy the note, or insert it
  // into an open message composer. This is a real, working path — not a stub.
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
  actions.append(insert)
  card.append(actions)

  card.append(el("p", "fallback-note", fallbackReason(outcome)))

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
