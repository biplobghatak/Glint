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
  avatar_url?: string
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

// One entry the model returns for a batch. `index` is the profile's position in
// the prompt's numbered list — it is how a score is matched back to a profile.
// A model that reordered or omitted an entry would otherwise shift every score
// onto the wrong lead, silently writing a stranger's score over someone.
type BatchScoreItem = {
  index: number
  match_score: number
  match_reasons: string[]
  country: string | null
}

// One entry of the batch response, returned in the caller's input order and
// carrying its own linkedin_url so the caller never has to trust order either.
type BatchResult = {
  linkedin_url: string | null
  match_score: number
  match_reasons: string[]
  min_score: number
  stored: boolean
  inserted: boolean
  lead_id?: string
}

// A whole page of leads is a lot of prompt and a lot of response; refuse a batch
// large enough that a single request would be slow, expensive, or truncate.
const MAX_BATCH = 20

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

// The batch schema mirrors SCORE_SCHEMA's strictness — OpenRouter's strict mode
// requires every property in `required`, so `country` is nullable, never
// optional. Each item carries its own `index` (the number from the prompt's
// list) so results can be matched back by identity, not by array position.
const BATCH_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          match_score: { type: "integer", minimum: 0, maximum: 100 },
          match_reasons: { type: "array", items: { type: "string" } },
          country: { type: ["string", "null"] },
        },
        required: ["index", "match_score", "match_reasons", "country"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
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

// Builds one prompt for a whole page. Leads are numbered from 0; the model must
// echo each lead's number back as `index`, which is what lets a reordered or
// partial response still land each score on the right person.
function batchScorePrompt(icp: Icp, profiles: ProfileData[]): string {
  const header = [
    "You score how well each LinkedIn lead matches a seller's ideal customer profile (ICP).",
    "You are given a NUMBERED list of leads. Score EVERY lead in the list.",
    "For each lead return an object with:",
    "- index: the lead's number from the list below, copied exactly.",
    "- match_score: 0-100 (100 = perfect fit).",
    "- match_reasons: 2-4 short reasons.",
    "- country: the lead's country as an ISO-3166 alpha-2 code (e.g. US, GB, DE),",
    "  inferred from their location line. LinkedIn writes regions, not countries — map",
    '  "Greater Seattle Area" to US, "Berlin, Germany" to DE. If the location is missing,',
    "  ambiguous, or names no country you can identify, return null. Do not guess from the",
    "  person's name, company, or language.",
    "",
    "ICP:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Pain points: ${(icp.pain_points ?? []).join(", ") || "n/a"}`,
    `- Summary: ${icp.raw_summary ?? "n/a"}`,
    "",
    "Leads:",
  ]
  const items = profiles.map((p, i) =>
    [
      `[${i}]`,
      `  Name: ${p.name ?? "n/a"}`,
      `  Headline/role: ${p.headline ?? "n/a"}`,
      `  Company: ${p.company ?? "n/a"}`,
      `  Location: ${p.location ?? "n/a"}`,
      `  Post/context: ${p.post_text ?? "n/a"}`,
    ].join("\n")
  )
  return [...header, items.join("\n\n")].join("\n")
}

// The batch path: score a whole results page in ONE LLM round-trip. It is
// deliberately awaited-loop-free — at most one dedupe query, one icps read, one
// LLM call, and one insert, no matter how many profiles arrive. Branched to from
// `handler` when the body carries `profiles`; the single-profile path below is
// left untouched so the passive scan and older builds keep their exact behaviour.
async function handleBatch(
  device_token: string | undefined,
  folder_id: string | null | undefined,
  profiles: ProfileData[] | undefined,
  jsonHeaders: Record<string, string>
): Promise<Response> {
  if (!device_token || !Array.isArray(profiles) || profiles.length === 0) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }
  if (profiles.length > MAX_BATCH) {
    return new Response(JSON.stringify({ error: "batch_too_large" }), {
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

  // The device_token is a bearer credential and score-lead runs with the
  // service-role key (RLS bypassed), so this filter is the ONLY barrier stopping
  // a leaked token from writing into a stranger's folder. Validate before any
  // expensive work, exactly as the single-profile path does.
  if (folder_id) {
    const { data: folder } = await supabase
      .from("folders")
      .select("id")
      .eq("id", folder_id)
      .eq("user_id", user_id)
      .maybeSingle()
    if (!folder) {
      return new Response(JSON.stringify({ error: "invalid_folder" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
  }

  // ONE dedupe query for the whole page. Every hit is returned as
  // stored:true, inserted:false and is neither re-scored nor relocated.
  const urls = profiles
    .map((p) => p.linkedin_url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)

  const dedupeByUrl = new Map<
    string,
    { id: string; match_score: number; match_reasons: string[] }
  >()
  if (urls.length > 0) {
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("id, linkedin_url, match_score, match_reasons")
      .eq("user_id", user_id)
      .in("linkedin_url", urls)
    for (const row of existingLeads ?? []) {
      dedupeByUrl.set(row.linkedin_url, row)
    }
  }

  // ONE icps read.
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
  const min_score = (icp as Icp).min_score ?? DEFAULT_MIN_SCORE

  // The profiles that actually need the LLM: everything that is not a dedupe
  // hit. Their position in this list is the `index` the model must echo back.
  const toScore: ProfileData[] = []
  const promptIndexByInput = new Map<number, number>()
  profiles.forEach((profile, inputIndex) => {
    const url = profile.linkedin_url
    if (url && dedupeByUrl.has(url)) return
    promptIndexByInput.set(inputIndex, toScore.length)
    toScore.push(profile)
  })

  // ONE LLM call for the whole page. maxTokens scales with the batch — a page
  // response is far larger than a single one and an under-budgeted call
  // truncates the JSON. Reasoning stays disabled (default) for the same reason.
  const scoreByIndex = new Map<number, BatchScoreItem>()
  if (toScore.length > 0) {
    let batch: { scores: BatchScoreItem[] }
    try {
      batch = await callLLMJson<{ scores: BatchScoreItem[] }>({
        schema: BATCH_SCHEMA,
        schemaName: "lead_scores",
        maxTokens: Math.min(4096, 256 + 160 * profiles.length),
        messages: [
          { role: "user", content: batchScorePrompt(icp as Icp, toScore) },
        ],
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: jsonHeaders,
      })
    }
    for (const s of batch.scores ?? []) {
      // Match by `index`, never by array position. A duplicate index keeps the
      // first; an out-of-range or non-numeric one is ignored.
      if (typeof s?.index === "number" && !scoreByIndex.has(s.index)) {
        scoreByIndex.set(s.index, s)
      }
    }
  }

  // Assemble results in the caller's input order. Rows at or above min_score are
  // collected for a single insert; each keeps a reference so its lead_id can be
  // filled in afterwards. A profile the model omitted is dropped entirely — the
  // caller leaves that card unbadged, which correctly reads as "not scored".
  const results: BatchResult[] = []
  const toInsert: { row: Record<string, unknown>; ref: BatchResult }[] = []

  profiles.forEach((profile, inputIndex) => {
    const url = profile.linkedin_url ?? null

    if (url && dedupeByUrl.has(url)) {
      const hit = dedupeByUrl.get(url)!
      results.push({
        linkedin_url: url,
        match_score: hit.match_score,
        match_reasons: hit.match_reasons,
        min_score,
        stored: true,
        inserted: false,
        lead_id: hit.id,
      })
      return
    }

    const promptIndex = promptIndexByInput.get(inputIndex)!
    const s = scoreByIndex.get(promptIndex)
    if (!s) return // model omitted this profile: absent from results

    if (s.match_score < min_score) {
      // Below threshold still returns the score and reasons — that is what keeps
      // the muted badge on the card. Absence of a badge must always mean
      // "not scored", never "scored low".
      results.push({
        linkedin_url: url,
        match_score: s.match_score,
        match_reasons: s.match_reasons,
        min_score,
        stored: false,
        inserted: false,
      })
      return
    }

    const ref: BatchResult = {
      linkedin_url: url,
      match_score: s.match_score,
      match_reasons: s.match_reasons,
      min_score,
      stored: true,
      inserted: true,
    }
    results.push(ref)
    toInsert.push({
      row: {
        user_id,
        name: profile.name ?? null,
        company: profile.company ?? null,
        role: profile.headline ?? null,
        linkedin_url: url,
        location: profile.location ?? null,
        country: normalizeCountry(s.country),
        post_context: profile.post_text ?? null,
        match_score: s.match_score,
        match_reasons: s.match_reasons,
        source: profile.source ?? "extension",
        folder_id: folder_id ?? null,
        avatar_url: profile.avatar_url ?? null,
      },
      ref,
    })
  })

  // ONE insert. PostgREST returns bulk inserts in input order, so the returned
  // rows line up with `toInsert` position-for-position.
  if (toInsert.length > 0) {
    const { data: insertedData, error: insertError } = await supabase
      .from("leads")
      .insert(toInsert.map((t) => t.row))
      .select("id, linkedin_url")

    if (insertError) {
      return new Response(JSON.stringify({ error: String(insertError.message) }), {
        status: 500,
        headers: jsonHeaders,
      })
    }
    ;(insertedData ?? []).forEach((r, k) => {
      if (toInsert[k]) toInsert[k].ref.lead_id = r.id
    })
  }

  return new Response(JSON.stringify({ results }), { headers: jsonHeaders })
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: {
    profile_data?: ProfileData
    device_token?: string
    /** The run's destination folder. Absent or null means unfiled. */
    folder_id?: string | null
    /** Present => batch mode: score a whole page in one call. 1..MAX_BATCH. */
    profiles?: ProfileData[]
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { profile_data, device_token, folder_id, profiles } = body

  // Batch mode is selected purely by the presence of `profiles`. The
  // single-profile path below is thereby left byte-for-byte unchanged for the
  // passive scan and any older extension build still calling it.
  if (profiles !== undefined) {
    return await handleBatch(device_token, folder_id, profiles, jsonHeaders)
  }

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

  // A device_token is a bearer credential, so every id it carries is untrusted.
  // Scope the lookup to this pairing's user_id: a folder that exists but belongs
  // to someone else must be indistinguishable from one that does not exist.
  if (folder_id) {
    const { data: folder } = await supabase
      .from("folders")
      .select("id")
      .eq("id", folder_id)
      .eq("user_id", user_id)
      .maybeSingle()
    if (!folder) {
      return new Response(JSON.stringify({ error: "invalid_folder" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
  }

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
      folder_id: folder_id ?? null,
      avatar_url: profile_data.avatar_url ?? null,
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
