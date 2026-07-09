import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { IcpForm } from "./icp-form"

export default async function SettingsIcpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: icp } = await supabase
    .from("icps")
    .select(
      "website_url, target_roles, company_types, pain_points, raw_summary, min_score"
    )
    .eq("user_id", user.id)
    .maybeSingle()

  // Editing presupposes something to edit. A user with no ICP row has not
  // finished onboarding, and onboarding is where the row gets created.
  if (!icp) {
    redirect("/onboarding")
  }

  return <IcpForm userId={user.id} icp={icp} />
}
