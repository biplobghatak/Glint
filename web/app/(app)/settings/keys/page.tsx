import { redirect } from "next/navigation"

import { getActiveSite } from "@/lib/sites"
import { PairingPanel } from "./pairing-panel"

export default async function SettingsKeysPage() {
  const site = await getActiveSite()
  if (!site) {
    redirect("/onboarding")
  }

  return <PairingPanel siteId={site.id} siteName={site.name} />
}
