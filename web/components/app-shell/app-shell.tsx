import { type ReactNode } from "react"

import { Header } from "./header"
import { Sidebar } from "./sidebar"

function AppShell({
  email,
  children,
}: {
  email: string
  children: ReactNode
}) {
  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header email={email} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

export { AppShell }
