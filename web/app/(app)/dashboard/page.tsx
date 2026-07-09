import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getActiveSite } from "@/lib/sites"
import { BUCKET_COUNT, DashboardView, type DashboardData } from "./dashboard-view"

/** No ICP row yet means no threshold has been chosen; `icps.min_score` defaults to 70. */
const DEFAULT_MIN_SCORE = 70

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
    supabase.from("icps").select("min_score").eq("site_id", site.id).maybeSingle(),
    supabase
      .from("leads")
      .select("id, name, company, role, linkedin_url, match_score")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  // A null match_score is a lead that was never scored, which is not a zero. It
  // belongs to no bucket, counts toward no average, and clears no threshold.
  const scoreValues = (scores ?? [])
    .map((l) => l.match_score)
    .filter((s): s is number => typeof s === "number")

  const avgScore =
    scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : null

  const minScore = icp?.min_score ?? DEFAULT_MIN_SCORE

  // Ten buckets of ten points. A perfect 100 has no bucket of its own, so it
  // shares the top one with the 90s.
  const histogram = Array<number>(BUCKET_COUNT).fill(0)
  for (const score of scoreValues) {
    histogram[Math.min(BUCKET_COUNT - 1, Math.floor(score / 10))] += 1
  }

  const totalLeads = total ?? 0
  const newLeads = newCount ?? 0
  const contactedLeads = contactedCount ?? 0

  const data: DashboardData = {
    totalLeads,
    newLeads,
    contactedLeads,
    // `status` is CHECK-constrained to new | contacted | ignored, so the three
    // segments are exhaustive and the remainder needs no query of its own.
    ignoredLeads: Math.max(0, totalLeads - newLeads - contactedLeads),
    avgScore,
    minScore,
    scoredCount: scoreValues.length,
    clearingCount: scoreValues.filter((s) => s >= minScore).length,
    histogram,
    recentLeads: recent ?? [],
  }

  return <DashboardView data={data} />
}
