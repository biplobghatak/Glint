import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Landing } from "@/components/landing"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <Landing />
  }

  // A user with no site has never finished onboarding. Sites came before ICPs
  // once they existed, so this is the earlier and more reliable signal.
  const { count } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })

  if (!count) {
    redirect("/onboarding")
  }

  redirect("/dashboard")
}
