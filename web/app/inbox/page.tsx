import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <p>Lead inbox coming in Day 2.</p>
    </div>
  )
}
