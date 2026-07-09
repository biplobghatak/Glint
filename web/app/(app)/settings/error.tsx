"use client"

import { RouteError } from "@/components/app-shell/route-error"

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError title="Settings" error={error} reset={reset} />
}
