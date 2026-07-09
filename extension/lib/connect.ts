/**
 * LinkedIn's note textarea is React-controlled. Assigning `el.value` mutates the
 * DOM node but never reaches React's internal state, so React re-renders over it
 * and the invitation posts with an EMPTY note. The value must be written through
 * the prototype's native setter, then an `input` event dispatched — that event
 * is what React's onChange is actually bound to.
 */
export function setReactTextareaValue(el: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set
  if (setter) setter.call(el, text)
  else el.value = text
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

// Tried in order. Both a top-level button and one inside the "More" overflow
// dropdown, because LinkedIn moves Connect between them by profile and by
// viewport. Every selector here is best-effort and fails soft.
const CONNECT_SELECTORS = [
  'button[aria-label^="Invite"]:not([disabled])',
  'button[aria-label*="to connect"]:not([disabled])',
  '.artdeco-dropdown__content button[aria-label*="connect" i]:not([disabled])',
] as const

export function findConnectButton(root: ParentNode): HTMLButtonElement | null {
  for (const selector of CONNECT_SELECTORS) {
    const button = root.querySelector<HTMLButtonElement>(selector)
    if (button) return button
  }
  return null
}

// UNVERIFIED against a live authenticated session, like every selector below
// this line. A human confirms these against the real LinkedIn markup later;
// until then they either work or fail soft, never guess further.
const MORE_BUTTON_SELECTOR = 'button[aria-label="More actions"], button[aria-label^="More"]'
const ADD_NOTE_BUTTON_SELECTOR = 'button[aria-label*="Add a note" i]'
const NOTE_TEXTAREA_SELECTOR = 'textarea[name="message"], #custom-message'

/** Polls `query` until it returns non-null or `timeoutMs` elapses. Never throws. */
function waitFor<T extends Element>(
  query: () => T | null,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<T | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      const el = query()
      if (el) {
        resolve(el)
        return
      }
      if (Date.now() >= deadline) {
        resolve(null)
        return
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

/**
 * Opens LinkedIn's Connect flow and fills the invitation note with `draft`.
 *
 * Glint NEVER clicks LinkedIn's Send. This function fills the textarea and
 * stops there; the human reads the note and sends it themselves. There is no
 * code path here that clicks a Send/submit button, and none should ever be
 * added -- automating the send is a realistic route to LinkedIn account
 * restriction and violates its ToS.
 *
 * Resilient to LinkedIn hiding Connect behind the "More" overflow menu: if no
 * Connect button is visible outright, the More menu is opened and the search
 * repeated before giving up.
 */
export async function openConnectAndFill(
  draft: string
): Promise<"filled" | "no_button" | "no_textarea"> {
  let button = findConnectButton(document)
  if (!button) {
    const moreButton = document.querySelector<HTMLButtonElement>(MORE_BUTTON_SELECTOR)
    moreButton?.click()
    button = await waitFor(() => findConnectButton(document))
  }
  if (!button) return "no_button"
  button.click()

  // The dialog may open straight to the note field, or to an intermediate
  // step with an "Add a note" button. Click it when present; do nothing when
  // it isn't.
  const addNoteButton = await waitFor(
    () => document.querySelector<HTMLButtonElement>(ADD_NOTE_BUTTON_SELECTOR),
    1500
  )
  addNoteButton?.click()

  const textarea = await waitFor(() =>
    document.querySelector<HTMLTextAreaElement>(NOTE_TEXTAREA_SELECTOR)
  )
  if (!textarea) return "no_textarea"

  setReactTextareaValue(textarea, draft)
  return "filled"
}
