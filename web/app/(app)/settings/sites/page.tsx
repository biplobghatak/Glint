import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getActiveSite, listSites } from "@/lib/sites"
import { SitesPanel, type SiteRow } from "./sites-panel"

export default async function SettingsSitesPage() {
  const supabase = await createClient()
  const sites = await listSites()

  if (sites.length === 0) {
    redirect("/onboarding")
  }

  const active = await getActiveSite(sites)

  // Deleting a site cascades its leads and folders, so the confirmation has to
  // say how many. Counted per site rather than grouped in the client, because
  // the client never sees another site's rows.
  const rows: SiteRow[] = await Promise.all(
    sites.map(async (site) => {
      const [{ count: leadCount }, { count: folderCount }] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("site_id", site.id),
        supabase
          .from("folders")
          .select("id", { count: "exact", head: true })
          .eq("site_id", site.id),
      ])
      return {
        ...site,
        leadCount: leadCount ?? 0,
        folderCount: folderCount ?? 0,
      }
    })
  )

  return <SitesPanel sites={rows} activeSiteId={active?.id ?? null} />
}
