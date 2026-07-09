"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { ACTIVE_SITE_COOKIE } from "@/lib/sites"

const YEAR_SECONDS = 60 * 60 * 24 * 365

async function switchSite(siteId: string): Promise<void> {
  const jar = await cookies()
  jar.set(ACTIVE_SITE_COOKIE, siteId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: YEAR_SECONDS,
  })

  // Every authed page reads the active site, so the whole shell is stale.
  revalidatePath("/", "layout")
}

// Deleting a site takes its leads, folders and pairings with it, by way of the
// `on delete cascade` on each child's composite foreign key. The confirmation
// lives in the UI; RLS is what stops this deleting someone else's site.
async function deleteSite(siteId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase.from("sites").delete().eq("id", siteId)
  if (error) {
    return { error: "Couldn't delete that site. Try again." }
  }

  // The cookie may now name a site that no longer exists. getActiveSite falls
  // back to the first remaining one, but clearing it avoids a confusing hop.
  const jar = await cookies()
  if (jar.get(ACTIVE_SITE_COOKIE)?.value === siteId) {
    jar.delete(ACTIVE_SITE_COOKIE)
  }

  revalidatePath("/", "layout")
  return { error: null }
}

export { deleteSite, switchSite }
