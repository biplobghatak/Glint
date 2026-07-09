import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell/page-header"

// Mirrors DashboardView's populated layout: the score card, the pipeline meter,
// then recent leads. Matching the real shape is the point — a generic spinner
// here would let the page jump when data lands.
export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        <Card>
          {/* The score card's eyebrow sits with its number, not in a CardHeader. */}
          <CardContent className="grid gap-8 md:grid-cols-[17rem_1fr] md:items-end md:gap-10">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-14 w-32 rounded" />
              <Skeleton className="h-4 w-48 rounded" />
            </div>
            <div className="flex h-44 items-end gap-1.5 pt-5">
              {[18, 26, 34, 52, 74, 100, 88, 60, 32, 16].map((height, i) => (
                <Skeleton
                  key={i}
                  className="flex-1 rounded-t-xs"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-3 w-20 rounded" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-4 w-24 rounded" />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-3 w-28 rounded" />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-3 w-44 rounded" />
                </div>
                <Skeleton className="h-5 w-9 rounded-sm" />
              </div>
            ))}
          </CardContent>
          <CardFooter>
            <Skeleton className="h-4 w-28 rounded" />
          </CardFooter>
        </Card>
      </div>
    </>
  )
}
