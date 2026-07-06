"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type IcpDraft = {
  target_roles: string
  company_types: string
  pain_points: string
  raw_summary: string
}

type GenerateIcpResponse =
  | { needs_manual_input: true }
  | {
      target_roles: string[]
      company_types: string[]
      pain_points: string[]
      raw_summary: string
    }

type Step = "url" | "manual" | "review" | "error"

function toIcpDraft(data: {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
}): IcpDraft {
  return {
    target_roles: data.target_roles.join("\n"),
    company_types: data.company_types.join("\n"),
    pain_points: data.pain_points.join("\n"),
    raw_summary: data.raw_summary,
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
  })
  const [loading, setLoading] = useState(false)

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data, error } = await supabase.functions.invoke<GenerateIcpResponse>(
      "generate-icp",
      { body: { website_url: websiteUrl } }
    )
    setLoading(false)

    if (error || !data) {
      setStep("error")
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

    const { data, error } = await supabase.functions.invoke<GenerateIcpResponse>(
      "generate-icp",
      { body: { website_url: websiteUrl, fallback_text: manualDescription } }
    )
    setLoading(false)

    if (error || !data || "needs_manual_input" in data) {
      setStep("error")
      return
    }
    setIcp(toIcpDraft(data))
    setStep("review")
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.from("icps").upsert(
      {
        user_id: userId,
        website_url: websiteUrl,
        target_roles: toArray(icp.target_roles),
        company_types: toArray(icp.company_types),
        pain_points: toArray(icp.pain_points),
        raw_summary: icp.raw_summary,
      },
      { onConflict: "user_id" }
    )
    setLoading(false)

    if (error) {
      setStep("error")
      return
    }
    router.push("/inbox")
  }

  if (step === "error") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <p className="text-destructive text-sm">Something went wrong. Try again.</p>
        <Button onClick={() => setStep("url")}>Start over</Button>
      </div>
    )
  }

  if (step === "manual") {
    return (
      <form
        onSubmit={handleManualSubmit}
        className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6"
      >
        <Label htmlFor="manual-description">
          We couldn&apos;t read your website. Tell us about your product instead.
        </Label>
        <Textarea
          id="manual-description"
          required
          rows={6}
          value={manualDescription}
          onChange={(e) => setManualDescription(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Generating..." : "Generate ICP"}
        </Button>
      </form>
    )
  }

  if (step === "review") {
    return (
      <form
        onSubmit={handleSave}
        className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="target-roles">Target roles (one per line)</Label>
          <Textarea
            id="target-roles"
            rows={3}
            value={icp.target_roles}
            onChange={(e) => setIcp({ ...icp, target_roles: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="company-types">Company types (one per line)</Label>
          <Textarea
            id="company-types"
            rows={3}
            value={icp.company_types}
            onChange={(e) => setIcp({ ...icp, company_types: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pain-points">Pain points (one per line)</Label>
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
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save"}
        </Button>
      </form>
    )
  }

  return (
    <form
      onSubmit={handleUrlSubmit}
      className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="website-url">Your website URL</Label>
        <Input
          id="website-url"
          type="url"
          required
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Generating..." : "Generate ICP"}
      </Button>
    </form>
  )
}
