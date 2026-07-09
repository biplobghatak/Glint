import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getActiveSite } from "@/lib/sites"
import { LeadInbox, type Lead } from "./lead-inbox"
import type { Folder } from "@/components/inbox/folder-rail"

export default async function InboxPage() {
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

  // The web app holds a JWT, so both reads go straight to Postgres under RLS.
  // The extension's device_token Edge Functions exist because the panel cannot
  // do this; routing the web app through them would buy nothing.
  const [{ data: leads }, { data: folders }] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, name, company, role, linkedin_url, post_context, match_score, match_reasons, status, folder_id, created_at"
      )
      .eq("site_id", site.id)
      .order("match_score", { ascending: false }),
    supabase.from("folders").select("id, name").eq("site_id", site.id).order("name"),
  ])

  return (
    <LeadInbox
      initialLeads={(leads ?? []) as Lead[]}
      initialFolders={(folders ?? []) as Folder[]}
      userId={user.id}
      siteId={site.id}
    />
  )
}
