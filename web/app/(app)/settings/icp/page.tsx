import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getActiveSite } from "@/lib/sites"
import { IcpForm } from "./icp-form"

export default async function SettingsIcpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const site = await getActiveSite()
  if (!site) {
    redirect("/onboarding")
  }

  const { data: icp } = await supabase
    .from("icps")
    .select(
      "website_url, target_roles, company_types, pain_points, raw_summary, min_score"
    )
    .eq("site_id", site.id)
    .maybeSingle()

  // Editing presupposes something to edit. A site with no ICP row has not
  // finished onboarding, and onboarding is where the row gets created.
  if (!icp) {
    redirect("/onboarding")
  }

  return <IcpForm siteId={site.id} siteName={site.name} icp={icp} />
}
