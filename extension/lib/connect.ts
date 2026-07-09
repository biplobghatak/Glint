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

/**
 * Every clickable thing, not just `<button>`.
 *
 * LinkedIn's overflow ("More") dropdown renders its items as
 * `div[role="button"]`, not as buttons. A `querySelector("button[...]")` cannot
 * see them, which is why Connect was never found once LinkedIn moved it into the
 * overflow — the most common placement on a 3rd-degree profile, which is most of
 * them.
 */
const CLICKABLE = 'button, [role="button"]'

function isEnabled(el: Element): boolean {
  if (el.hasAttribute("disabled")) return false
  if (el.getAttribute("aria-disabled") === "true") return false
  return true
}

/** aria-label, else the visible text. Both are things LinkedIn rotates. */
function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label")
  if (aria?.trim()) return aria.trim()
  return (el.textContent ?? "").replace(/\s+/g, " ").trim()
}

function findClickable(root: ParentNode, matches: (label: string) => boolean) {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(CLICKABLE))) {
    if (!isEnabled(el)) continue
    if (matches(labelOf(el))) return el
  }
  return null
}

/**
 * The Connect control, wherever LinkedIn has put it this week.
 *
 * Matched on meaning rather than markup: the aria-label reads "Invite Jane Doe
 * to connect" on the top card and inside the More menu alike, and the visible
 * text is exactly "Connect". Both are checked, because LinkedIn ships profiles
 * with one, the other, or both.
 *
 * The exact-text test is deliberately anchored (`^connect$`). A substring match
 * would also hit "Connect with more people", "Connections", and the invitation
 * manager — clicking any of which navigates the user off the profile.
 */
export function findConnectButton(root: ParentNode): HTMLElement | null {
  return findClickable(
    root,
    (label) => /^invite\b.*\bto connect$/i.test(label) || /^connect$/i.test(label)
  )
}

/** The overflow trigger that hides Connect on most profiles. */
export function findMoreButton(root: ParentNode): HTMLElement | null {
  return findClickable(
    root,
    (label) => /^more actions?$/i.test(label) || /^more$/i.test(label)
  )
}

/**
 * The "Add a note" control inside the invite dialog.
 *
 * Free accounts get a limited number of noted invites per month; when that runs
 * out LinkedIn hides this control entirely. Its absence is therefore an ordinary
 * outcome to report, not an error to retry.
 */
export function findAddNoteButton(root: ParentNode): HTMLElement | null {
  return findClickable(root, (label) => /^add a note$/i.test(label))
}

const NOTE_TEXTAREA_SELECTOR =
  'textarea[name="message"], #custom-message, textarea#custom-message'

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

/** What happened, in enough detail that the card can say something true. */
export type ConnectOutcome =
  | "filled"
  /** No Connect control anywhere — already connected, or invite withdrawn/pending. */
  | "no_button"
  /** Dialog opened, but LinkedIn offered no note field (free-tier note quota spent). */
  | "no_note_option"
  /** Note field never appeared. Markup drift, most likely. */
  | "no_textarea"

/**
 * Dumps what WAS on the page when we found nothing.
 *
 * Every LinkedIn selector here is best-effort, and the failure mode that has
 * cost the most time is a silent one: "couldn't open the dialog" tells the next
 * reader nothing about whether the button was missing, renamed, or moved.
 */
function debugClickables(): void {
  const labels = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE))
    .filter(isEnabled)
    .map(labelOf)
    .filter((l) => l.length > 0 && l.length < 60)
  console.debug("Glint: no Connect control. Clickable labels on page:", labels)
}

/**
 * Opens LinkedIn's Connect flow and fills the invitation note with `draft`.
 *
 * Glint NEVER clicks LinkedIn's Send. This function fills the textarea and stops
 * there; the human reads the note and sends it themselves. There is no code path
 * here that clicks a Send/submit button, and none should ever be added --
 * automating the send is a realistic route to LinkedIn account restriction and
 * violates its ToS.
 *
 * Searches the top card first, then opens the "More" overflow and searches the
 * dropdown that appears. Scoped to `main` where possible: a bare document-wide
 * search for "Connect" also matches the Connect buttons on "People also viewed"
 * cards in the sidebar, and would invite the wrong person.
 */
export async function openConnectAndFill(draft: string): Promise<ConnectOutcome> {
  const scope: ParentNode = document.querySelector("main") ?? document

  let button = findConnectButton(scope)
  if (!button) {
    const moreButton = findMoreButton(scope)
    if (moreButton) {
      moreButton.click()
      // The dropdown mounts asynchronously; re-search the whole scope rather
      // than the trigger's subtree, since LinkedIn portals the menu elsewhere.
      button = await waitFor(() => findConnectButton(scope), 2000)
    }
  }
  if (!button) {
    debugClickables()
    return "no_button"
  }
  button.click()

  // The dialog may open straight to the note field, or to an intermediate step
  // with an "Add a note" button. The dialog is portalled to the body, so search
  // the document here, not `scope`.
  const addNote = await waitFor(() => findAddNoteButton(document), 2000)
  const textareaAlready = document.querySelector<HTMLTextAreaElement>(NOTE_TEXTAREA_SELECTOR)
  if (!addNote && !textareaAlready) return "no_note_option"
  addNote?.click()

  const textarea = await waitFor(() =>
    document.querySelector<HTMLTextAreaElement>(NOTE_TEXTAREA_SELECTOR)
  )
  if (!textarea) return "no_textarea"

  setReactTextareaValue(textarea, draft)
  return "filled"
}
