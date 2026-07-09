import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell/page-header"

// Mirrors DashboardView's populated layout: a 4-up stat grid, then a two-column
// row of ICP + recent leads. Matching the real shape is the point — a generic
// spinner here would let the page jump when data lands.
export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-6 p-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="gap-2">
              <CardHeader>
                <Skeleton className="h-4 w-24 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-20 rounded" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {Array.from({ length: 3 }, (_, group) => (
                <div key={group} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-28 rounded" />
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 3 }, (_, pill) => (
                      <Skeleton key={pill} className="h-5 w-20 rounded-full" />
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28 rounded" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-3 w-44 rounded" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-md" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
