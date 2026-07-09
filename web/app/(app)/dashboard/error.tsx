"use client"

import { RouteError } from "@/components/app-shell/route-error"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError title="Dashboard" error={error} reset={reset} />
}
