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
  location?: string
  post_text?: string
  linkedin_url?: string
  source?: "extension" | "profile" | "post" | "search_result"
}

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
  raw_summary: string | null
  min_score: number
}

type ScoreResult = {
  match_score: number
  match_reasons: string[]
  country: string | null
}

// OpenRouter's strict json_schema with additionalProperties:false requires
// EVERY property to appear in `required`. An optional field is therefore
// modelled as a nullable type, never by omission from `required` — leaving
// `country` out would be rejected outright rather than treated as optional.
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    match_score: { type: "integer", minimum: 0, maximum: 100 },
    match_reasons: { type: "array", items: { type: "string" } },
    country: { type: ["string", "null"] },
  },
  required: ["match_score", "match_reasons", "country"],
  additionalProperties: false,
}

// Mirrors icps.min_score's column default. Used only when a user somehow has no
// icps row on a code path that must still answer (the dedup branch).
const DEFAULT_MIN_SCORE = 70

// The schema constrains `country` to string-or-null, not to a valid alpha-2
// code, so the model can still hand back "USA", "us", or a sentence. Anything
// that isn't exactly two letters becomes null: a wrong country silently
// misfiles a lead under a filter the user trusts, while null lands it in the
// "Unknown" chip that is on by default.
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  const c = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) ? c : null
}

function scorePrompt(icp: Icp, profile: ProfileData): string {
  return [
    "You score how well a LinkedIn lead matches a seller's ideal customer profile (ICP).",
    "Return a match_score from 0-100 (100 = perfect fit) and 2-4 short match_reasons.",
    "",
    "Also return `country`: the lead's country as an ISO-3166 alpha-2 code (e.g. US, GB, DE),",
    "inferred from their location line. LinkedIn writes regions, not countries — map",
    '"Greater Seattle Area" to US, "Berlin, Germany" to DE. If the location is missing,',
    "ambiguous, or names no country you can identify, return null. Do not guess from the",
    "person's name, company, or language.",
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
    `- Location: ${profile.location ?? "n/a"}`,
    `- Post/context: ${profile.post_text ?? "n/a"}`,
  ].join("\n")
}

export async function handler(req: Request): Promise<Response> {
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
      // This branch returns before the LLM is ever called — which is why a lead
      // scored before the country migration never gets `country` backfilled by
      // ordinary browsing. Do NOT "fix" that by scoring here; re-scoring every
      // already-seen card is precisely the cost this branch exists to avoid.
      //
      // min_score still has to come back, though: the content script gates the
      // badge on it, and a deduped card must be badged identically to a
      // freshly-scored one. Fetched separately rather than by hoisting the icps
      // read above this branch, because that would start returning 404 no_icp
      // for deduped leads that today return 200.
      const { data: icpRow } = await supabase
        .from("icps")
        .select("min_score")
        .eq("user_id", user_id)
        .maybeSingle()

      return new Response(
        JSON.stringify({
          lead_id: existing.id,
          match_score: existing.match_score,
          match_reasons: existing.match_reasons,
          min_score: icpRow?.min_score ?? DEFAULT_MIN_SCORE,
          // A row exists for this lead. The dedupe branch never re-scores, so
          // it also never re-evaluates the threshold: a lead stored under an
          // older, lower min_score stays stored.
          stored: true,
          // This call wrote nothing — the row was already here. leadCount is
          // meant to bound NEW work, so a re-encountered lead must not count.
          inserted: false,
        }),
        { headers: jsonHeaders }
      )
    }
  }

  const { data: icp, error: icpError } = await supabase
    .from("icps")
    .select("target_roles, company_types, pain_points, raw_summary, min_score")
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

  // Computed, returned, discarded. Returning the score regardless is what keeps
  // the muted badge on the card: absence of a badge must always mean "Glint has
  // not scored this", never "Glint scored it low".
  //
  // Not a one-way door. The dedupe branch above keys on an existing row, and a
  // discarded lead has none, so re-running the same search re-scores it and
  // stores it under a lower threshold. What is lost is the LLM call.
  if (score.match_score < icp.min_score) {
    return new Response(
      JSON.stringify({
        match_score: score.match_score,
        match_reasons: score.match_reasons,
        min_score: icp.min_score,
        stored: false,
        inserted: false,
      }),
      { headers: jsonHeaders }
    )
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert({
      user_id,
      name: profile_data.name ?? null,
      company: profile_data.company ?? null,
      role: profile_data.headline ?? null,
      linkedin_url: profile_data.linkedin_url ?? null,
      location: profile_data.location ?? null,
      country: normalizeCountry(score.country),
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
      min_score: (icp as Icp).min_score ?? DEFAULT_MIN_SCORE,
      stored: true,
      // This call wrote the row. Only this path increments the run's leadCount.
      inserted: true,
    }),
    { headers: jsonHeaders }
  )
}
