import { getDeviceToken } from "@/lib/pairing"
import type { LeadCandidate } from "@/lib/extract"

const env = import.meta.env as unknown as Record<string, string>

// min_score rides along on the score response so the content script can decide
// whether a badge is muted without a second round-trip per card. It is the
// user's icps.min_score, not a property of this lead.
export type ScoreResult = {
  match_score: number
  match_reasons: string[]
  min_score: number
}

export async function scoreLead(
  candidate: LeadCandidate
): Promise<ScoreResult | null> {
  const device_token = await getDeviceToken()
  if (!device_token) return null

  try {
    const res = await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/score-lead`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.WXT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        device_token,
        profile_data: {
          name: candidate.name,
          headline: candidate.headline,
          company: candidate.company,
          location: candidate.location,
          post_text: candidate.post_text,
          linkedin_url: candidate.linkedin_url,
          source: candidate.source,
        },
      }),
    })
    if (!res.ok) return null
    return (await res.json()) as ScoreResult
  } catch {
    return null
  }
}
