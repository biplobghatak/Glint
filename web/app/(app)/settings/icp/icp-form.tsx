"use client"

import { useState, type FormEvent } from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Icp = {
  website_url: string | null
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string | null
  min_score: number
}

type Status = "idle" | "saving" | "saved" | "error"

function toLines(values: string[]): string {
  return values.join("\n")
}

function toArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function IcpForm({
  siteId,
  siteName,
  icp,
}: {
  siteId: string
  siteName: string
  icp: Icp
}) {
  const supabase = createClient()

  const [websiteUrl, setWebsiteUrl] = useState(icp.website_url ?? "")
  const [targetRoles, setTargetRoles] = useState(toLines(icp.target_roles))
  const [companyTypes, setCompanyTypes] = useState(toLines(icp.company_types))
  const [painPoints, setPainPoints] = useState(toLines(icp.pain_points))
  const [rawSummary, setRawSummary] = useState(icp.raw_summary ?? "")
  const [minScore, setMinScore] = useState(String(icp.min_score))
  const [status, setStatus] = useState<Status>("idle")

  const score = Number(minScore)
  const scoreValid = Number.isInteger(score) && score >= 0 && score <= 100

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!scoreValid) {
      return
    }
    setStatus("saving")

    // UPDATE, not upsert. The row already exists (the page redirects to
    // onboarding when it doesn't), and this is the one screen that is allowed
    // to write min_score — onboarding deliberately omits it so re-running
    // onboarding never resets the user's threshold.
    //
    // Scoped by site_id, never user_id: icps.user_id stopped being unique when
    // sites arrived, so a user_id predicate would rewrite every one of this
    // user's websites at once.
    const { error } = await supabase
      .from("icps")
      .update({
        website_url: websiteUrl,
        target_roles: toArray(targetRoles),
        company_types: toArray(companyTypes),
        pain_points: toArray(painPoints),
        raw_summary: rawSummary,
        min_score: score,
      })
      .eq("site_id", siteId)

    setStatus(error ? "error" : "saved")
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Ideal customer profile</CardTitle>
          <CardDescription>
            Glint scores every lead for {siteName} against this profile. Put one
            item per line.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="website-url">Your website</Label>
            <Input
              id="website-url"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="target-roles">Target roles</Label>
            <Textarea
              id="target-roles"
              rows={4}
              value={targetRoles}
              onChange={(e) => setTargetRoles(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="company-types">Company types</Label>
            <Textarea
              id="company-types"
              rows={4}
              value={companyTypes}
              onChange={(e) => setCompanyTypes(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pain-points">Pain points</Label>
            <Textarea
              id="pain-points"
              rows={4}
              value={painPoints}
              onChange={(e) => setPainPoints(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="raw-summary">Summary</Label>
            <Textarea
              id="raw-summary"
              rows={4}
              value={rawSummary}
              onChange={(e) => setRawSummary(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Match threshold</CardTitle>
          <CardDescription>
            Leads scoring below this are kept, but shown muted and never
            enriched. Scores run 0 to 100.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-40 flex-col gap-2">
            <Label htmlFor="min-score">Minimum score</Label>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              step={1}
              required
              aria-invalid={!scoreValid}
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
            />
            {!scoreValid && (
              <p className="text-destructive text-sm">
                Enter a whole number between 0 and 100.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={status === "saving" || !scoreValid}
          className="self-start"
        >
          {status === "saving" ? "Saving..." : "Save changes"}
        </Button>
        {status === "saved" && (
          <p className="text-muted-foreground text-sm">Saved.</p>
        )}
        {status === "error" && (
          <p className="text-destructive text-sm">
            Couldn&apos;t save your profile. Try again.
          </p>
        )}
      </div>
    </form>
  )
}
