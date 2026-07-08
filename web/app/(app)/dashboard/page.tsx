import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardView, type DashboardData } from "./dashboard-view"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
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
      .eq("user_id", user.id),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "new"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "contacted"),
    supabase.from("leads").select("match_score").eq("user_id", user.id),
    supabase
      .from("icps")
      .select("target_roles, company_types, pain_points")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("leads")
      .select("id, name, company, role, linkedin_url, match_score")
      .eq("user_id", user.id)
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
