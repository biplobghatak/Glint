import { getDeviceToken } from "@/lib/pairing"
import type { LeadCandidate } from "@/lib/extract"

const env = import.meta.env as unknown as Record<string, string>

/** The run's destination folder no longer exists. The run cannot continue. */
export class InvalidFolderError extends Error {}

// min_score rides along on the score response so the content script can decide
// whether a badge is muted without a second round-trip per card. It is the
// user's icps.min_score, not a property of this lead.
export type ScoreResult = {
  match_score: number
  match_reasons: string[]
  min_score: number
  /**
   * Whether a `leads` row exists for this lead. False when the score was
   * computed but discarded for falling below the user's min_score. The card is
   * still badged (muted); it is simply not stored. Dedupe → true, fresh
   * insert → true, discard → false.
   */
  stored: boolean
  /**
   * Whether THIS call wrote the row. Distinct from `stored`: a dedupe hit is
   * `stored: true, inserted: false` because the row already existed. Only
   * `inserted` drives the run's leadCount — the cap bounds new work, not leads
   * merely re-encountered on a re-run.
   */
  inserted: boolean
}

export async function scoreLead(
  candidate: LeadCandidate,
  folderId: string | null
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
        folder_id: folderId,
      }),
    })
    if (res.status === 400) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null
      if (detail?.error === "invalid_folder") throw new InvalidFolderError("invalid_folder")
      // This call site only ever sends a folder_id when the run has one, so a
      // 400 whose body didn't parse is far more likely to be invalid_folder
      // (the server's response was truncated, non-JSON, or otherwise unreadable)
      // than anything else. Falling through to `return null` here would file
      // the next card into a folder the server has already rejected. Named
      // failures with parseable bodies (missing_fields, invalid_json) still
      // fall through below.
      if (detail === null) {
        console.warn("Glint: score-lead 400 with an unparseable body; treating as invalid_folder")
        throw new InvalidFolderError("invalid_folder")
      }
    }
    if (!res.ok) return null
    return (await res.json()) as ScoreResult
  } catch (err) {
    // A deleted destination folder must stop the run, not read as a scoring
    // miss. Let it propagate; every other failure (network, parse) degrades to
    // a skipped card as before.
    if (err instanceof InvalidFolderError) throw err
    return null
  }
}
