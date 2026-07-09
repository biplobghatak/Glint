import { getDeviceToken } from "@/lib/pairing"
import type { LeadCandidate } from "@/lib/extract"

const env = import.meta.env as unknown as Record<string, string>

/** The run's destination folder no longer exists. The run cannot continue. */
export class InvalidFolderError extends Error {}

// min_score rides along on the score response so the content script can decide
// whether a badge is muted without a second round-trip per card. It is the
// user's icps.min_score, not a property of this lead.
export type ScoreResult = {
  /**
   * The id of the `leads` row. Present only on the fresh-insert path — the run
   * uses it to queue the lead for a contact-info visit. Absent for a discard
   * (below min_score, nothing stored) and for a dedupe hit that returns the
   * existing row without re-enriching it this run.
   */
  lead_id?: string
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
          avatar_url: candidate.avatar_url,
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

// One entry of the batch response, mirroring score-lead's BatchResult. Unlike
// ScoreResult it also echoes the profile's linkedin_url, so the caller can
// assert a result landed on the right card instead of trusting array order
// alone.
export type BatchScore = {
  linkedin_url: string | null
  lead_id?: string
  match_score: number
  match_reasons: string[]
  min_score: number
  stored: boolean
  inserted: boolean
}

// Score a whole page of candidates in ONE request. Returns the results in the
// order the candidates were sent (the endpoint preserves input order); returns
// null on any failure so the caller can fall back to per-card scoreLead rather
// than abandoning the page. Throws InvalidFolderError exactly as scoreLead does
// — a deleted destination folder must stop the run, not read as an outage —
// which is why the InvalidFolderError re-throw sits past the outer catch.
export async function scoreLeads(
  candidates: LeadCandidate[],
  folderId: string | null
): Promise<BatchScore[] | null> {
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
        folder_id: folderId,
        profiles: candidates.map((candidate) => ({
          name: candidate.name,
          headline: candidate.headline,
          company: candidate.company,
          location: candidate.location,
          post_text: candidate.post_text,
          linkedin_url: candidate.linkedin_url,
          source: candidate.source,
          avatar_url: candidate.avatar_url,
        })),
      }),
    })
    if (res.status === 400) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null
      if (detail?.error === "invalid_folder") throw new InvalidFolderError("invalid_folder")
      // This call site only ever sends a folder_id when the run has one, so a
      // 400 whose body didn't parse is far more likely to be invalid_folder
      // than anything else — filing the rest of the page into a folder the
      // server has already rejected. Named failures with parseable bodies
      // (missing_fields, batch_too_large, invalid_json) still fall through.
      if (detail === null) {
        console.warn("Glint: score-lead 400 with an unparseable body; treating as invalid_folder")
        throw new InvalidFolderError("invalid_folder")
      }
    }
    if (!res.ok) return null
    const body = (await res.json()) as { results?: BatchScore[] }
    return body.results ?? null
  } catch (err) {
    if (err instanceof InvalidFolderError) throw err
    return null
  }
}

// Pairs each pending card with its scored result BY POSITION — the endpoint
// returns results in the exact order the profiles were sent. Position alone is
// not trusted: wherever both the sent candidate and the echoed result carry a
// linkedin_url, they must agree, or the result is discarded for that card
// (logged loudly, left unbadged) rather than risk stamping one person's score
// onto another's card. A card with no result at its position (the model omitted
// it, so the endpoint dropped it and the arrays run ragged) is simply absent
// from the output and stays unbadged — which reads correctly as "not scored".
// Generic over the node type so it stays pure and DOM-free for testing.
export function pairResultsToCards<N>(
  pending: { node: N; cand: LeadCandidate }[],
  results: BatchScore[]
): { node: N; cand: LeadCandidate; result: BatchScore }[] {
  const paired: { node: N; cand: LeadCandidate; result: BatchScore }[] = []
  for (let i = 0; i < pending.length; i++) {
    const result = results[i]
    if (!result) continue
    const { node, cand } = pending[i]
    const sentUrl = cand.linkedin_url
    const echoedUrl = result.linkedin_url
    if (sentUrl && echoedUrl && sentUrl !== echoedUrl) {
      console.warn(
        `Glint: batch score URL mismatch at index ${i} (sent ${sentUrl}, echoed ${echoedUrl}); skipping to avoid badging the wrong person`
      )
      continue
    }
    paired.push({ node, cand, result })
  }
  return paired
}
