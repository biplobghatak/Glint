import { browser } from "wxt/browser"

const DRAFT_KEY = "glint_draft"

// A draft outlives the click that created it: the panel writes it, then opens a
// new tab, and the content script on that tab reads it. chrome.storage.local is
// the only channel that spans that gap.
export type StoredDraft = {
  /** LinkedIn profile path, e.g. "/in/jane-doe". Matched against location.pathname. */
  profilePath: string
  opener: string
  leadName: string
  /** Epoch ms. Anything older than DRAFT_TTL_MS is ignored and cleared. */
  createdAt: number
  /**
   * True when draft-opener failed and this is the lead's match_reasons shown
   * verbatim instead of a written opener. The card says so rather than passing
   * bullet points off as a message.
   */
  isFallback: boolean
}

// Long enough to survive a slow profile load, short enough that a draft for a
// tab the user closed before it loaded cannot ambush them on the next profile
// they happen to open.
export const DRAFT_TTL_MS = 2 * 60 * 1000

/** Extracts "/in/jane-doe" from a full LinkedIn profile URL. */
export function profilePathOf(linkedinUrl: string): string | null {
  try {
    const path = new URL(linkedinUrl).pathname.replace(/\/+$/, "")
    return path.startsWith("/in/") ? path : null
  } catch {
    return null
  }
}

export async function putDraft(draft: StoredDraft): Promise<void> {
  await browser.storage.local.set({ [DRAFT_KEY]: draft })
}

/**
 * Reads the pending draft if — and only if — it belongs to this page and is
 * still fresh, then deletes it. Single-use by construction: a draft that has
 * been shown once must not reappear on a back-navigation.
 *
 * A stale or mismatched draft is cleared too. Leaving it would mean the next
 * profile the user opens is greeted with someone else's opener.
 */
export async function consumeDraft(pathname: string): Promise<StoredDraft | null> {
  const stored = await browser.storage.local.get(DRAFT_KEY)
  const draft = stored[DRAFT_KEY] as StoredDraft | undefined
  if (!draft) return null

  const expired = Date.now() - draft.createdAt > DRAFT_TTL_MS
  const mine = pathname.replace(/\/+$/, "") === draft.profilePath

  if (expired || !mine) {
    // Only clear an expired draft. A draft for a *different* profile may still
    // be in flight — the user could have opened this page in between — so it is
    // left alone until its own page claims it or its TTL runs out.
    if (expired) await browser.storage.local.remove(DRAFT_KEY)
    return null
  }

  await browser.storage.local.remove(DRAFT_KEY)
  return draft
}
