import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AppNav } from "@/components/app-nav"
import { LeadInbox, type Lead } from "./lead-inbox"

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, name, company, role, linkedin_url, post_context, match_score, match_reasons, status, created_at"
    )
    .eq("user_id", user.id)
    .order("match_score", { ascending: false })

  return (
    <>
      <AppNav />
      <LeadInbox initialLeads={(leads ?? []) as Lead[]} userId={user.id} />
    </>
  )
}
