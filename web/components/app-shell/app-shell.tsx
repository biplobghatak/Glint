import { type ReactNode } from "react"

import type { Site } from "@/lib/sites"
import { Header } from "./header"
import { Sidebar } from "./sidebar"

function AppShell({
  email,
  sites,
  activeSiteId,
  children,
}: {
  email: string
  sites: Site[]
  activeSiteId: string | null
  children: ReactNode
}) {
  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar sites={sites} activeSiteId={activeSiteId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header email={email} sites={sites} activeSiteId={activeSiteId} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

export { AppShell }
