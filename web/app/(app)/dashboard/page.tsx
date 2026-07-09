import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getActiveSite } from "@/lib/sites"
import { DashboardView, type DashboardData } from "./dashboard-view"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Every figure on this page belongs to one website. Scoping by site_id rather
  // than user_id is what stops a second product's leads inflating the first's.
  const site = await getActiveSite()
  if (!site) {
    redirect("/onboarding")
  }

  const [
    { count: total },
    { count: newCount },
    { count: contactedCount },
    { data: scores },
    { data: icp },
    { data: recent },
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("site_id", site.id),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("site_id", site.id)
      .eq("status", "new"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("site_id", site.id)
      .eq("status", "contacted"),
    supabase.from("leads").select("match_score").eq("site_id", site.id),
    supabase
      .from("icps")
      .select("target_roles, company_types, pain_points")
      .eq("site_id", site.id)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("id, name, company, role, linkedin_url, match_score")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const scoreValues = (scores ?? [])
    .map((l) => l.match_score)
    .filter((s): s is number => typeof s === "number")
  const avgScore =
    scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : null

  const data: DashboardData = {
    totalLeads: total ?? 0,
    newLeads: newCount ?? 0,
    contactedLeads: contactedCount ?? 0,
    avgScore,
    icp: icp ?? null,
    recentLeads: recent ?? [],
  }

  return <DashboardView data={data} />
}
