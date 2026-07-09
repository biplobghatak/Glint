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
 * A single bucket, filled grey below the ICP threshold and green above it.
 *
 * The threshold is any integer 0-100, so it routinely lands *inside* a bucket
 * rather than on a boundary — a 75 cuts the 70-80 bar in half. Painting the
 * whole bar one colour would then contradict the hairline drawn through it, so
 * the fill splits at the exact same fraction the hairline sits at.
 */
function HistogramBar({
  count,
  tallest,
  bucket,
  minScore,
}: {
  count: number
  tallest: number
  bucket: number
  minScore: number
}) {
  const start = bucket * 10
  const belowFraction = Math.min(1, Math.max(0, (minScore - start) / 10))

  // An empty bucket collapses to nothing; the baseline rule carries the eye
  // across the gap. A non-empty one keeps a visible stub.
  const height = count === 0 ? 0 : Math.max((count / tallest) * 100, 4)

  return (
    <div
      className="flex h-full flex-1 items-end px-[3px]"
      title={`${formatScore(start)}–${formatScore(start + 10)}: ${count}`}
    >
      <div
        className="w-full overflow-hidden rounded-t-xs"
        style={{ height: `${height}%` }}
      >
        <div className="flex h-full w-full">
          <div
            className="h-full shrink-0 bg-foreground/10"
            style={{ width: `${belowFraction * 100}%` }}
          />
          <div className="h-full flex-1 bg-primary" />
        </div>
      </div>
    </div>
  )
}

/**
 * The distribution of every scored lead, with the ICP threshold drawn across it.
 *
 * Bars sit on an exact ten-percent grid — each bucket is a full-width `flex-1`
 * cell with the gutter pushed *inside* as padding. A `gap-*` between the bars
 * would shrink each cell below a tenth of the track, and the threshold hairline
 * (positioned at a literal `minScore%` of that track) would drift off the
 * fraction it marks.
 */
function ScoreHistogram({
  histogram,
  minScore,
}: {
  histogram: number[]
  minScore: number
}) {
  const tallest = Math.max(...histogram, 1)

  // The label is centred on the hairline, except near the ends where it would
  // spill out of the card.
  const anchor =
    minScore <= 8
      ? "left-0"
      : minScore >= 92
        ? "right-0"
        : "left-1/2 -translate-x-1/2"

  return (
    <div className="flex w-full flex-col gap-2">
      {/* pt-5 reserves a row for the threshold label so it never collides with
          the tallest bar. */}
      <div
        className="relative h-44 pt-5"
        role="img"
        aria-label={`Distribution of match scores across ten buckets, with a threshold at ${formatScore(minScore)}`}
      >
        <div className="flex h-full items-end border-b border-border">
          {histogram.map((count, bucket) => (
            <HistogramBar
              key={bucket}
              count={count}
              tallest={tallest}
              bucket={bucket}
              minScore={minScore}
            />
          ))}
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0"
          style={{ left: `${minScore}%` }}
        >
          <div className="absolute top-5 bottom-0 w-0 border-l border-dashed border-foreground/30" />
          <span
            className={cn(
              "absolute top-0 font-mono text-[0.6875rem] whitespace-nowrap text-muted-foreground tabular-nums",
              anchor
            )}
          >
            {formatScore(minScore)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
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
      {/* No CardHeader here on purpose. The eyebrow labels the number, so it
          travels with it — parked at the card's top it left a dead band the
          height of the chart between the two. */}
      {/* The page's max-width is what keeps the chart honest: stretched across a
          wide viewport its ten bars turn into slabs wider than they are tall,
          which reads as anything but a distribution. */}
      <CardContent className="grid gap-8 md:grid-cols-[17rem_1fr] md:items-end md:gap-10">
        <div>
          <CardTitle>Average match</CardTitle>
          <p className="mt-3 font-heading text-6xl leading-none font-semibold tracking-tight">
            {formatScoreOrDash(data.avgScore)}
          </p>
          {data.scoredCount > 0 ? (
            <p className="mt-4 text-sm text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">
                {data.clearingCount} of {data.scoredCount}
              </span>{" "}
              scored leads clear your {formatScore(data.minScore)} bar.
            </p>
          ) : (
            <p className="mt-4 text-sm text-pretty text-muted-foreground">
              Nothing scored yet. Scores land as the extension reads each profile.
            </p>
          )}
          {unscored > 0 && data.scoredCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
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
      <span className={cn("size-2 shrink-0 rounded-full", swatch)} aria-hidden />
      <span className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{count}</span> {label}
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
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: width(data.contactedLeads) }} />
          <div className="bg-primary/35" style={{ width: width(data.newLeads) }} />
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
            swatch="bg-primary/35"
          />
          <PipelineSegment
            label="ignored"
            count={data.ignoredLeads}
            total={data.totalLeads}
            swatch="bg-foreground/10"
          />
          <span className="ml-auto text-sm text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
        )}
        <ul className="divide-y divide-border">
          {data.recentLeads.map((lead) => {
            const clears =
              lead.match_score !== null && lead.match_score >= data.minScore
            return (
              <li
                key={lead.id}
                className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0"
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
                  className="font-mono text-xs tracking-normal tabular-nums"
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
        <div className="mx-auto w-full max-w-5xl p-4">
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
      {/* Without a max width every card spans the viewport: the histogram's bars
          flatten out and a lead's score badge drifts a screen away from its name. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        <ScoreCard data={data} />
        <PipelineCard data={data} />
        <RecentLeadsCard data={data} />
      </div>
    </>
  )
}
