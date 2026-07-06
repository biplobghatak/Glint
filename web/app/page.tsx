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

  const { data: icp } = await supabase
    .from("icps")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!icp) {
    redirect("/onboarding")
  }

  redirect("/inbox")
}
