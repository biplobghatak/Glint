/** LinkedIn's connection-note limit is UNVERIFIED; 200 is the product requirement. */
export const MAX_OPENER_CHARS = 200

const DASHES = /[—–]/
// The opener is pasted into a Connect note, so it must read like a message to a
// person, not a fragment. The model is told the exact greeting to use; this is
// the check that it did.
const GREETING = /^(hi|hello|hey)\b/i
// A draft the user has to find-and-replace before sending is worse than no
// draft: the failure is silent and lands in the recipient's inbox.
const PLACEHOLDER = /\[[^\]]*\]|\{\{[^}]*\}\}|<[a-z_ ]+>/i
// Imperative openers a model actually produces. Deliberately a small, explicit
// list rather than a part-of-speech guess: a false negative costs one retry, a
// false positive ships a flat statement the user has to rewrite.
const CTA_IMPERATIVE =
  /\b(let me know|open to|worth a|happy to|shall we|would you|can we|keen to|interested in|reach out|get in touch|say hi|connect)\b/i

/**
 * The opener's contract, enforced on the model's RESPONSE, not by prompt text.
 *
 * A model instructed not to use em dashes will use one eventually, and a silent
 * 240-character draft is truncated by LinkedIn's textarea without telling
 * anyone. Prompt instructions are a request; this is the check.
 */
export function validateOpener(text: string): { ok: true } | { ok: false; reason: string } {
  const t = text.trim()
  if (t.length === 0) return { ok: false, reason: "empty" }
  if (t.length > MAX_OPENER_CHARS) return { ok: false, reason: "too_long" }
  if (DASHES.test(t)) return { ok: false, reason: "dash" }
  if (!GREETING.test(t)) return { ok: false, reason: "no_greeting" }
  if (PLACEHOLDER.test(t)) return { ok: false, reason: "placeholder" }
  // A call to action: the opener ends by asking for something. Either it ends
  // in a question mark, or its final sentence carries an imperative phrase.
  const lastSentence = t.split(/(?<=[.!?])\s+/).at(-1) ?? t
  if (t.endsWith("?") || CTA_IMPERATIVE.test(lastSentence)) return { ok: true }
  return { ok: false, reason: "no_cta" }
}
