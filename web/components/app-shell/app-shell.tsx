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
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header email={email} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}

export { AppShell }
