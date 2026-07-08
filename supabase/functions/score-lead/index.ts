import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

type ProfileData = {
  name?: string
  headline?: string
  company?: string
  post_text?: string
  linkedin_url?: string
  source?: "extension" | "profile" | "post" | "search_result"
}

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
  raw_summary: string | null
}

type ScoreResult = {
  match_score: number
  match_reasons: string[]
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    match_score: { type: "integer", minimum: 0, maximum: 100 },
    match_reasons: { type: "array", items: { type: "string" } },
  },
  required: ["match_score", "match_reasons"],
  additionalProperties: false,
}

function scorePrompt(icp: Icp, profile: ProfileData): string {
  return [
    "You score how well a LinkedIn lead matches a seller's ideal customer profile (ICP).",
    "Return a match_score from 0-100 (100 = perfect fit) and 2-4 short match_reasons.",
    "",
    "ICP:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Pain points: ${(icp.pain_points ?? []).join(", ") || "n/a"}`,
    `- Summary: ${icp.raw_summary ?? "n/a"}`,
    "",
    "Lead:",
    `- Name: ${profile.name ?? "n/a"}`,
    `- Headline/role: ${profile.headline ?? "n/a"}`,
    `- Company: ${profile.company ?? "n/a"}`,
    `- Post/context: ${profile.post_text ?? "n/a"}`,
  ].join("\n")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { profile_data?: ProfileData; device_token?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { profile_data, device_token } = body
  if (!device_token || !profile_data) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: pairing } = await supabase
    .from("extension_pairings")
    .select("user_id")
    .eq("device_token", device_token)
    .maybeSingle()

  if (!pairing) {
    return new Response(JSON.stringify({ error: "unpaired" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  const user_id = pairing.user_id

  if (profile_data.linkedin_url) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, match_score, match_reasons")
      .eq("user_id", user_id)
      .eq("linkedin_url", profile_data.linkedin_url)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({
          lead_id: existing.id,
          match_score: existing.match_score,
          match_reasons: existing.match_reasons,
        }),
        { headers: jsonHeaders }
      )
    }
  }

  const { data: icp, error: icpError } = await supabase
    .from("icps")
    .select("target_roles, company_types, pain_points, raw_summary")
    .eq("user_id", user_id)
    .maybeSingle()

  if (icpError) {
    return new Response(JSON.stringify({ error: String(icpError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
  if (!icp) {
    return new Response(JSON.stringify({ error: "no_icp" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  let score: ScoreResult
  try {
    score = await callLLMJson<ScoreResult>({
      schema: SCORE_SCHEMA,
      schemaName: "lead_score",
      maxTokens: 512,
      messages: [{ role: "user", content: scorePrompt(icp as Icp, profile_data) }],
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: jsonHeaders,
    })
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert({
      user_id,
      name: profile_data.name ?? null,
      company: profile_data.company ?? null,
      role: profile_data.headline ?? null,
      linkedin_url: profile_data.linkedin_url ?? null,
      post_context: profile_data.post_text ?? null,
      match_score: score.match_score,
      match_reasons: score.match_reasons,
      source: profile_data.source ?? "extension",
    })
    .select("id")
    .single()

  if (insertError) {
    return new Response(JSON.stringify({ error: String(insertError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(
    JSON.stringify({
      lead_id: inserted.id,
      match_score: score.match_score,
      match_reasons: score.match_reasons,
    }),
    { headers: jsonHeaders }
  )
})
