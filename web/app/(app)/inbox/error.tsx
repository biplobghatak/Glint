"use client"

import { RouteError } from "@/components/app-shell/route-error"

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError title="Inbox" error={error} reset={reset} />
}
