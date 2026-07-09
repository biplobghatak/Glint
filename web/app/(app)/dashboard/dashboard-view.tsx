import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/app-shell/page-header"
import { formatScoreOrDash } from "@/lib/format"

export type DashboardData = {
  totalLeads: number
  newLeads: number
  contactedLeads: number
  avgScore: number | null
  icp: {
    target_roles: string[] | null
    company_types: string[] | null
    pain_points: string[] | null
  } | null
  recentLeads: {
    id: string
    name: string | null
    company: string | null
    role: string | null
    linkedin_url: string | null
    match_score: number | null
  }[]
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-3xl font-semibold">{value}</CardContent>
    </Card>
  )
}

function IcpPillGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="normal-case">
            {v}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function IcpCard({ icp }: { icp: NonNullable<DashboardData["icp"]> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your ICP</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <IcpPillGroup label="Target roles" values={icp.target_roles ?? []} />
        <IcpPillGroup label="Company types" values={icp.company_types ?? []} />
        <IcpPillGroup label="Pain points" values={icp.pain_points ?? []} />
      </CardContent>
    </Card>
  )
}

export function DashboardView({ data }: { data: DashboardData }) {
  if (data.totalLeads === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="flex flex-col gap-6 p-4">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No leads yet. Connect the extension to start scoring leads.
              </p>
              <Link
                href="/settings"
                className="text-sm font-medium underline underline-offset-4"
              >
                Go to Settings
              </Link>
            </CardContent>
          </Card>
          {data.icp && <IcpCard icp={data.icp} />}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-6 p-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total leads" value={String(data.totalLeads)} />
          <StatCard label="New" value={String(data.newLeads)} />
          <StatCard label="Contacted" value={String(data.contactedLeads)} />
          <StatCard label="Avg match score" value={formatScoreOrDash(data.avgScore)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {data.icp && <IcpCard icp={data.icp} />}

          <Card>
            <CardHeader>
              <CardTitle>Recent leads</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.recentLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads yet.</p>
              ) : (
                data.recentLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {lead.name ?? "Unknown"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[lead.role, lead.company].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline">{formatScoreOrDash(lead.match_score)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
            <CardFooter>
              <Link
                href="/inbox"
                className="text-sm font-medium underline underline-offset-4"
              >
                View all →
              </Link>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  )
}
