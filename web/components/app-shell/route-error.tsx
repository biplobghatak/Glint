"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"

/**
 * Shared body for every route's error.tsx. Next requires the error boundary
 * itself to be a client component that default-exports `{ error, reset }`, so
 * each route keeps a thin file of its own; the shape lives here.
 */
export function RouteError({
  title,
  error,
  reset,
}: {
  title: string
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // `digest` is the only handle on the server-side stack, which Next strips
    // from the client payload in production. Without logging it, a production
    // error here is unmatchable against the server logs.
    console.error(`Glint: ${title} route error`, error.digest ?? "", error)
  }, [title, error])

  return (
    <>
      <PageHeader title={title} />
      <div className="p-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm font-medium">Something went wrong loading {title.toLowerCase()}.</p>
            <p className="text-muted-foreground max-w-prose text-sm">
              This is usually temporary. If it keeps happening, the details are in
              your browser console.
            </p>
            <Button onClick={reset} variant="outline" size="sm">
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
