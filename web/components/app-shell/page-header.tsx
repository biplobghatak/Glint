import { type ReactNode } from "react"

function PageHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

export { PageHeader }
