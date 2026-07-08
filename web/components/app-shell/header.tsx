import { MobileSidebar } from "./sidebar"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

function Header({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center border-b border-border bg-background/80 p-4 backdrop-blur">
      <MobileSidebar />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu email={email} />
      </div>
    </header>
  )
}

export { Header }
