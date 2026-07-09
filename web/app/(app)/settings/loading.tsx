import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// Rendered inside SettingsLayout, so the page header and tab nav are already on
// screen. This stands in for the active subpage's cards only.
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-9 w-44" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
