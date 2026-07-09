"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
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
import { Stepper } from "./stepper"

type IcpFields = {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
  target_countries: string[]
}

type IcpDraft = {
  target_roles: string
  company_types: string
  pain_points: string
  raw_summary: string
  // Carried through from generate-icp rather than edited here. The panel's
  // country filter is the place this is actually exercised; surfacing a raw
  // alpha-2 list in onboarding would ask the user to type "DE" from memory.
  target_countries: string[]
}

type GenerateIcpResponse = { needs_manual_input: true } | IcpFields

// Failure is not a step. Keeping it out of this union means a failed
// generate-icp leaves the user on the screen they were already on, with what
// they typed still in the field, instead of throwing them to a dead end.
type Step = "url" | "manual" | "review"

const STEPS = ["Website", "Review", "Done"] as const

function toIcpDraft(data: IcpFields): IcpDraft {
  return {
    target_roles: data.target_roles.join("\n"),
    company_types: data.company_types.join("\n"),
    pain_points: data.pain_points.join("\n"),
    raw_summary: data.raw_summary,
    target_countries: data.target_countries ?? [],
  }
}

function toArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function OnboardingFlow({ userId }: { userId: string }) {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<Step>("url")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [manualDescription, setManualDescription] = useState("")
  const [icp, setIcp] = useState<IcpDraft>({
    target_roles: "",
    company_types: "",
    pain_points: "",
    raw_summary: "",
    target_countries: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: fnError } =
      await supabase.functions.invoke<GenerateIcpResponse>("generate-icp", {
        body: { website_url: websiteUrl },
      })
    setLoading(false)

    if (fnError || !data) {
      setError("We couldn't reach your website. Check the URL and try again.")
      return
    }
    if ("needs_manual_input" in data) {
      setStep("manual")
      return
    }
    setIcp(toIcpDraft(data))
    setStep("review")
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: fnError } =
      await supabase.functions.invoke<GenerateIcpResponse>("generate-icp", {
        body: { website_url: websiteUrl, fallback_text: manualDescription },
      })
    setLoading(false)

    if (fnError || !data || "needs_manual_input" in data) {
      setError("We couldn't build a profile from that. Add a little more detail.")
      return
    }
    setIcp(toIcpDraft(data))
    setStep("review")
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // icps.user_id is unique — one row per user — so re-running onboarding
    // UPDATEs the existing row rather than inserting a second one.
    //
    // Enumerate columns, and never list min_score here. PostgREST turns this
    // payload into `on conflict (user_id) do update set <the keys below>`, so
    // any column named here is overwritten and any column omitted survives.
    // Adding min_score (or spreading a whole ICP object) would silently reset
    // the user's score threshold to the column default every time they redo
    // onboarding — the threshold is theirs, not the LLM's to regenerate.
    const { error: saveError } = await supabase.from("icps").upsert(
      {
        user_id: userId,
        website_url: websiteUrl,
        target_roles: toArray(icp.target_roles),
        company_types: toArray(icp.company_types),
        pain_points: toArray(icp.pain_points),
        raw_summary: icp.raw_summary,
        target_countries: icp.target_countries,
      },
      { onConflict: "user_id" }
    )
    setLoading(false)

    if (saveError) {
      setError("Couldn't save your profile. Try again.")
      return
    }
    router.push("/inbox")
  }

  const stepIndex = step === "review" ? 1 : 0

  const errorNote = error && (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  )

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-6">
        <span className="text-xl font-bold tracking-tight">
          Glint<span className="text-primary">.</span>
        </span>
        <Stepper steps={STEPS} current={stepIndex} />
      </div>

      {step === "url" && (
        <Card className="w-full max-w-md">
          <form onSubmit={handleUrlSubmit}>
            <CardHeader>
              <CardTitle>Your website</CardTitle>
              <CardDescription>
                We&apos;ll read it and draft the profile Glint scores leads
                against. You can edit everything on the next screen.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="website-url">Website URL</Label>
                <Input
                  id="website-url"
                  type="url"
                  placeholder="https://example.com"
                  required
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
              </div>
              {errorNote}
              <Button type="submit" disabled={loading}>
                {loading ? "Reading your site..." : "Continue"}
              </Button>
            </CardContent>
          </form>
        </Card>
      )}

      {step === "manual" && (
        <Card className="w-full max-w-md">
          <form onSubmit={handleManualSubmit}>
            <CardHeader>
              <CardTitle>Tell us about your product</CardTitle>
              <CardDescription>
                We couldn&apos;t read {websiteUrl || "your website"}. Describe
                what you sell and who buys it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="manual-description">What you sell</Label>
                <Textarea
                  id="manual-description"
                  required
                  rows={6}
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                />
              </div>
              {errorNote}
              <Button type="submit" disabled={loading}>
                {loading ? "Building your profile..." : "Continue"}
              </Button>
            </CardContent>
          </form>
        </Card>
      )}

      {step === "review" && (
        <Card className="w-full max-w-lg">
          <form onSubmit={handleSave}>
            <CardHeader>
              <CardTitle>Review your profile</CardTitle>
              <CardDescription>
                One item per line. Glint scores every lead against this.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="target-roles">Target roles</Label>
                <Textarea
                  id="target-roles"
                  rows={3}
                  value={icp.target_roles}
                  onChange={(e) => setIcp({ ...icp, target_roles: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="company-types">Company types</Label>
                <Textarea
                  id="company-types"
                  rows={3}
                  value={icp.company_types}
                  onChange={(e) =>
                    setIcp({ ...icp, company_types: e.target.value })
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pain-points">Pain points</Label>
                <Textarea
                  id="pain-points"
                  rows={3}
                  value={icp.pain_points}
                  onChange={(e) => setIcp({ ...icp, pain_points: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="raw-summary">Summary</Label>
                <Textarea
                  id="raw-summary"
                  rows={4}
                  value={icp.raw_summary}
                  onChange={(e) => setIcp({ ...icp, raw_summary: e.target.value })}
                />
              </div>
              {errorNote}
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save and find leads"}
              </Button>
            </CardContent>
          </form>
        </Card>
      )}
    </div>
  )
}
