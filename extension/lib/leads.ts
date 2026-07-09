import { getDeviceToken } from "@/lib/pairing"
import type { LeadFilter, LeadStatus } from "@/lib/filter"
import type { FolderRow } from "@/lib/folders"

const env = import.meta.env as unknown as Record<string, string>

export type LeadRow = {
  id: string
  name: string | null
  company: string | null
  role: string | null
  linkedin_url: string | null
  location: string | null
  country: string | null
  match_score: number | null
  match_reasons: string[] | null
  status: LeadStatus
  folder_id: string | null
  created_at: string
  avatar_url: string | null
  email: string | null
  phone: string | null
  /** ISO timestamp of the last contact-info lookup. Null = never looked up. */
  enriched_at: string | null
}

// Keyset cursor. Carries both ordering columns because the sort mode decides
// which one paginates; `id` makes the ordering total.
export type LeadCursor = {
  match_score: number | null
  created_at: string | null
  id: string
}

export type ListLeadsResponse = {
  leads: LeadRow[]
  next_cursor: LeadCursor | null
  below_threshold_count: number
  min_score: number
  has_icp: boolean
  target_countries: string[]
  /** Shipped with the leads so the folder <select> fills in one round-trip. */
  folders: FolderRow[]
}

export const PAGE_SIZE = 25

// Thrown for anything the panel should surface. An aborted request is NOT an
// error — it means a newer request superseded this one — so it rethrows the
// DOMException and callers ignore AbortError.
export class LeadsError extends Error {}

export async function listLeads(
  filter: LeadFilter,
  cursor: LeadCursor | null,
  signal: AbortSignal
): Promise<ListLeadsResponse> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new LeadsError("unpaired")

  const res = await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/list-leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ device_token, filter, cursor, limit: PAGE_SIZE }),
    signal,
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new LeadsError(detail?.error ?? `list_leads_failed_${res.status}`)
  }
  return (await res.json()) as ListLeadsResponse
}

/**
 * Persists the user's score threshold. The panel cannot write icps directly:
 * it holds a device_token, not a JWT, and icps' RLS is auth.uid() = user_id.
 */
export async function updateMinScore(minScore: number): Promise<number> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new LeadsError("unpaired")

  const res = await fetch(`${env.WXT_SUPABASE_URL}/functions/v1/update-icp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ device_token, min_score: minScore }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null
    throw new LeadsError(detail?.error ?? `update_icp_failed_${res.status}`)
  }
  const data = (await res.json()) as { min_score: number }
  return data.min_score
}
