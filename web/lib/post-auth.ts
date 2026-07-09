import { createClient } from "@/lib/supabase/server"

/**
 * Where a signed-in visitor belongs, or `null` if nobody is signed in.
 *
 * A user with no site has never finished onboarding. Sites came before ICPs
 * once they existed, so this is the earlier and more reliable signal.
 *
 * The marketing homepage stays reachable to everyone, so this check lives on
 * `/login` and `/signup` instead: land on an auth page while already signed in
 * and you get bounced straight through to the app.
 */
export async function signedInDestination(): Promise<
  "/dashboard" | "/onboarding" | null
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { count } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })

  return count ? "/dashboard" : "/onboarding"
}
