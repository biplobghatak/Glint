import { getDeviceToken } from "@/lib/pairing"

const env = import.meta.env as unknown as Record<string, string>

export class SuggestionsError extends Error {}

/** Thrown on 429. The panel says "wait a moment" rather than silently no-opping. */
export class RateLimitedError extends SuggestionsError {}

/**
 * Thrown on 502 — the model failed. Not a dead end: the caller falls back to
 * showing the lead's stored match_reasons, so the user still gets something to
 * send. Distinct from a generic failure precisely so that fallback can fire.
 */
export class DraftUnavailableError extends SuggestionsError {}

export async function fetchDraft(leadId: string): Promise<string> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new SuggestionsError("unpaired")

  const res = await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/draft-opener`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ device_token, lead_id: leadId }),
  })

  if (res.status === 429) throw new RateLimitedError("too_many_requests")
  // 502 means the model failed, deliberately distinguished from 500 so the
  // caller can substitute match_reasons instead of showing an error.
  if (res.status === 502) throw new DraftUnavailableError("llm_unavailable")

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new SuggestionsError(detail?.error ?? `draft_opener_failed_${res.status}`)
  }
  const data = (await res.json()) as { opener: string }
  return data.opener
}
