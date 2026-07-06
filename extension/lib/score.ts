import { getDeviceToken } from "@/lib/pairing"
import type { LeadCandidate } from "@/lib/extract"

const env = import.meta.env as unknown as Record<string, string>

export type ScoreResult = { match_score: number; match_reasons: string[] }

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
