import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"

const ACTIVE_SITE_COOKIE = "glint_site_id"

type Site = {
  id: string
  name: string
  website_url: string
}

async function listSites(): Promise<Site[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("sites")
    .select("id, name, website_url")
    .order("created_at", { ascending: true })

  return (data ?? []) as Site[]
}

// The cookie is client-controlled, so it is a preference, never a credential. It
// only ever selects among the sites RLS already returned for this user: an id
// that is not in that list resolves to the first site rather than to whatever it
// names. Forging it can therefore reorder your own sites and nothing else.
async function getActiveSite(sites?: Site[]): Promise<Site | null> {
  const all = sites ?? (await listSites())
  if (all.length === 0) {
    return null
  }

  const jar = await cookies()
  const wanted = jar.get(ACTIVE_SITE_COOKIE)?.value

  return all.find((s) => s.id === wanted) ?? all[0]
}

export { ACTIVE_SITE_COOKIE, getActiveSite, listSites }
export type { Site }
