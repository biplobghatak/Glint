import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell/page-header"

// Mirrors PairingPanel: a card with the generate action, then the list of
// paired devices.
export default function SettingsLoading() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 p-4">
        <Card>
          <CardHeader className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-3 w-72 rounded" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-9 w-44 rounded-md" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-36 rounded" />
                    <Skeleton className="h-3 w-24 rounded" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
