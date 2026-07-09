import type { Site } from "@/lib/sites"
import { MobileSidebar } from "./sidebar"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

function Header({
  email,
  sites,
  activeSiteId,
}: {
  email: string
  sites: Site[]
  activeSiteId: string | null
}) {
  return (
    <header className="z-30 flex shrink-0 items-center border-b border-border bg-background/80 p-4 backdrop-blur">
      <MobileSidebar sites={sites} activeSiteId={activeSiteId} />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu email={email} />
      </div>
    </header>
  )
}

export { Header }
