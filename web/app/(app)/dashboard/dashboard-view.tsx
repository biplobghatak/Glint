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
import { formatScore, formatScoreOrDash } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Ten buckets of ten points, over the stored 0-100 scale. */
export const BUCKET_COUNT = 10

export type DashboardData = {
  totalLeads: number
  newLeads: number
  contactedLeads: number
  ignoredLeads: number
  avgScore: number | null
  /** The ICP threshold, on the stored 0-100 scale. */
  minScore: number
  scoredCount: number
  clearingCount: number
  /** Counts per bucket, low to high. Length is always BUCKET_COUNT. */
  histogram: number[]
  recentLeads: {
    id: string
    name: string | null
    company: string | null
    role: string | null
    linkedin_url: string | null
    match_score: number | null
  }[]
}

/**
 * The distribution of every scored lead, with the ICP threshold drawn across it.
 *
 * Bars sit on an exact ten-percent grid — each bucket is a full-width `flex-1`
 * cell with the gap pushed *inside* as padding. A `gap-*` between the bars would
 * shrink each cell below a tenth of the track, and the threshold hairline (which
 * is positioned at a literal `minScore%` of that track) would drift off the
 * bucket boundary it is supposed to sit on.
 */
function ScoreHistogram({
  histogram,
  minScore,
}: {
  histogram: number[]
  minScore: number
}) {
  const tallest = Math.max(...histogram, 1)

  // Near the right edge the label would overflow the card, so it flips to the
  // inside of the line.
  const labelFlipped = minScore > 60

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative h-32"
        role="img"
        aria-label={`Distribution of match scores across ten buckets, with a threshold at ${formatScore(minScore)}`}
      >
        <div className="flex h-full items-end">
          {histogram.map((count, bucket) => {
            const clears = bucket * 10 >= minScore
            const filled = count > 0
            return (
              <div
                key={bucket}
                className="flex h-full flex-1 items-end px-[3px]"
                title={`${formatScore(bucket * 10)}–${formatScore(bucket * 10 + 10)}: ${count}`}
              >
                <div
                  className={cn(
                    "w-full rounded-t-xs",
                    clears ? "bg-primary" : "bg-foreground/10"
                  )}
                  // An empty bucket keeps a hairline of height so the baseline
                  // reads as a track rather than a ragged gap.
                  style={{
                    height: filled
                      ? `${Math.max((count / tallest) * 100, 3)}%`
                      : "2px",
                  }}
                />
              </div>
            )
          })}
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30"
          style={{ left: `${minScore}%` }}
        >
          <span
            className={cn(
              "absolute top-0 font-mono text-[0.625rem] tracking-widest whitespace-nowrap text-muted-foreground",
              labelFlipped ? "right-1.5" : "left-1.5"
            )}
          >
            {formatScore(minScore)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 font-mono text-[0.625rem] tracking-widest text-muted-foreground">
        <span>0</span>
        <span className="text-center">5</span>
        <span className="text-right">10</span>
      </div>
    </div>
  )
}

function ScoreCard({ data }: { data: DashboardData }) {
  const unscored = data.totalLeads - data.scoredCount

  return (
    <Card>
      <CardHeader>
        <CardTitle>Average match</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-8 md:grid-cols-[minmax(0,15rem)_1fr] md:items-end md:gap-12">
        <div>
          <p className="font-heading text-6xl leading-none font-semibold tracking-tight tabular-nums">
            {formatScoreOrDash(data.avgScore)}
          </p>
          {data.scoredCount > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {data.clearingCount} of {data.scoredCount}
              </span>{" "}
              scored leads clear your {formatScore(data.minScore)} bar.
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing scored yet. Scores land as the extension reads each profile.
            </p>
          )}
          {unscored > 0 && data.scoredCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {unscored} not scored yet
            </p>
          )}
        </div>

        {data.scoredCount > 0 && (
          <ScoreHistogram histogram={data.histogram} minScore={data.minScore} />
        )}
      </CardContent>
    </Card>
  )
}

function PipelineSegment({
  label,
  count,
  total,
  swatch,
}: {
  label: string
  count: number
  total: number
  swatch: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-2 shrink-0 rounded-xs", swatch)} aria-hidden />
      <span className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{count}</span>{" "}
        {label}
      </span>
      <span className="sr-only">of {total}</span>
    </div>
  )
}

function PipelineCard({ data }: { data: DashboardData }) {
  const width = (count: number) => `${(count / data.totalLeads) * 100}%`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: width(data.contactedLeads) }} />
          <div className="bg-primary/30" style={{ width: width(data.newLeads) }} />
          <div className="bg-foreground/10" style={{ width: width(data.ignoredLeads) }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <PipelineSegment
            label="contacted"
            count={data.contactedLeads}
            total={data.totalLeads}
            swatch="bg-primary"
          />
          <PipelineSegment
            label="new"
            count={data.newLeads}
            total={data.totalLeads}
            swatch="bg-primary/30"
          />
          <PipelineSegment
            label="ignored"
            count={data.ignoredLeads}
            total={data.totalLeads}
            swatch="bg-foreground/10"
          />
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {data.totalLeads} total
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function RecentLeadsCard({ data }: { data: DashboardData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent leads</CardTitle>
      </CardHeader>
      <CardContent>
        {data.recentLeads.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing to show yet.
          </p>
        )}
        <ul className="divide-y divide-border">
          {data.recentLeads.map((lead) => {
            const clears =
              lead.match_score !== null && lead.match_score >= data.minScore
            return (
              <li
                key={lead.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {lead.name ?? "Unknown"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[lead.role, lead.company].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge
                  variant={clears ? "default" : "outline"}
                  className="font-mono tabular-nums"
                >
                  {formatScoreOrDash(lead.match_score)}
                </Badge>
              </li>
            )
          })}
        </ul>
      </CardContent>
      <CardFooter>
        <Link
          href="/inbox"
          className="rounded-xs text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          View all leads →
        </Link>
      </CardFooter>
    </Card>
  )
}

export function DashboardView({ data }: { data: DashboardData }) {
  if (data.totalLeads === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-4">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-heading text-lg font-semibold tracking-tight">
                No leads yet
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Glint scores each profile your extension reads on LinkedIn. Pair
                the extension and the first scores will land here.
              </p>
              <Link
                href="/settings/keys"
                className="mt-1 rounded-xs text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                Pair the extension
              </Link>
            </CardContent>
          </Card>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="flex flex-col gap-4 p-4">
        <ScoreCard data={data} />
        <PipelineCard data={data} />
        <RecentLeadsCard data={data} />
      </div>
    </>
  )
}
