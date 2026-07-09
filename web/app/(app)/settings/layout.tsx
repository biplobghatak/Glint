import { type ReactNode } from "react"

import { PageHeader } from "@/components/app-shell/page-header"
import { SettingsNav } from "./settings-nav"

export default function SettingsLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <>
      <PageHeader title="Settings">
        <SettingsNav />
      </PageHeader>
      {children}
    </>
  )
}
