import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getActiveSite, listSites } from "@/lib/sites"
import { AppShell } from "@/components/app-shell/app-shell"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const sites = await listSites()
  const active = await getActiveSite(sites)

  return (
    <AppShell
      email={user.email ?? ""}
      sites={sites}
      activeSiteId={active?.id ?? null}
    >
      {children}
    </AppShell>
  )
}
