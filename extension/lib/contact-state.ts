export type ContactState = "not_looked_up" | "no_public_info" | "has_info"

/**
 * `enriched_at` is what makes this three-way rather than two-way. Without it, a
 * null email cannot be told apart from a profile we never opened, and the card
 * would have to lie in one direction or the other:
 *
 * - null                -> we have never opened this profile: "not looked up yet".
 * - set, email+phone null -> we looked; this member publishes neither. A normal,
 *   common outcome for an out-of-network profile: "no public contact info".
 * - set, either present  -> show what we have.
 */
export function contactState(lead: {
  email: string | null
  phone: string | null
  enriched_at: string | null
}): ContactState {
  if (lead.enriched_at === null) return "not_looked_up"
  return lead.email || lead.phone ? "has_info" : "no_public_info"
}
