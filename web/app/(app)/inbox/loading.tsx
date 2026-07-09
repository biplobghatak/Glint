import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/app-shell/page-header"

// Mirrors LeadInbox: the filter/search/sort row, then a stack of lead cards
// each carrying a left border accent. Eight rows is roughly a viewport.
export default function InboxLoading() {
  return (
    <>
      <PageHeader title="Inbox" />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-16 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="ml-auto h-9 w-40 rounded-md" />
        </div>

        <div className="flex flex-col gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i} className="border-l-border border-l-4">
              <CardContent className="flex items-start justify-between gap-4 py-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-3 w-56 rounded" />
                  <Skeleton className="h-3 w-72 rounded" />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Skeleton className="h-6 w-10 rounded-md" />
                  <Skeleton className="h-8 w-28 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
