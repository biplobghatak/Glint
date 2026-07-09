import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"

// Drafts a short outreach opener for one lead, from the user's ICP and the
// lead's stored match_reasons. Device-token authenticated; resolves user_id
// server-side and never accepts a client-supplied one.
//
// This is the ONLY per-click, synchronous, user-facing LLM call in Glint.
// score-lead is amortized across a paced 20-minute run and its latency is
// invisible; this one blocks a button the user just pressed. Hence the rate
// limit, the timeout, and the caller-side fallback (a 502 tells the panel to
// show match_reasons verbatim rather than spin forever).
//
// The draft is never sent. The panel hands it to the content script, which
// renders it in a card with Copy and Insert; Insert fills LinkedIn's composer
// only if the user already opened it, and nothing here or there submits it.
//
// Runs as the service role, which bypasses RLS: the user_id predicates below
// are the only thing scoping these rows.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

// Two draft requests inside this window is a double-click or a runaway loop,
// not a person composing outreach.
const RATE_LIMIT_MS = 5_000
const LLM_TIMEOUT_MS = 20_000
const MAX_OPENER_CHARS = 400

// OpenRouter runs strict json_schema with additionalProperties:false, which
// requires EVERY property to appear in `required`. Optionality is expressed as
// a nullable type, never by omitting a key.
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    opener: {
      type: "string",
      description:
        "A LinkedIn outreach opener, at most 400 characters. No greeting placeholder like [Name] or {{first_name}}. References one concrete match reason. No sign-off.",
    },
  },
  required: ["opener"],
  additionalProperties: false,
}

type Draft = { opener: string }

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
}

type Lead = {
  name: string | null
  company: string | null
  role: string | null
  match_reasons: string[] | null
}

function draftPrompt(icp: Icp, lead: Lead): string {
  // match_reasons is why this lead scored well, in the model's own earlier
  // words. It is the most specific thing we know about them. When it is empty
  // (an old lead, or a terse scoring pass) fall back to role and company rather
  // than inventing a reason the user would have to defend in a reply.
  const reasons = lead.match_reasons ?? []
  const grounding =
    reasons.length > 0
      ? `Why they match: ${reasons.join("; ")}`
      : `What we know: ${[lead.role, lead.company].filter(Boolean).join(" at ") || "very little"}`

  return [
    "Write the opening message of a LinkedIn outreach conversation.",
    "",
    "The sender sells to:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Pain points they solve: ${(icp.pain_points ?? []).join(", ") || "n/a"}`,
    "",
    "The recipient:",
    `- Name: ${lead.name ?? "unknown"}`,
    `- Role: ${lead.role ?? "unknown"}`,
    `- Company: ${lead.company ?? "unknown"}`,
    `- ${grounding}`,
    "",
    "Rules:",
    `- At most ${MAX_OPENER_CHARS} characters.`,
    "- Reference one concrete, specific reason this person is relevant.",
    "- No greeting placeholder tokens. Address them by name directly, or not at all.",
    "- No sign-off, no signature, no 'Best regards'.",
    "- Plain, direct, and human. No marketing adjectives. Do not claim you read something you did not.",
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

  let body: { device_token?: string; lead_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token, lead_id } = body
  if (!device_token || typeof lead_id !== "string") {
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
    .select("user_id, last_draft_at")
    .eq("device_token", device_token)
    .maybeSingle()

  if (!pairing) {
    return new Response(JSON.stringify({ error: "unpaired" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  const user_id = pairing.user_id

  // Rate limit BEFORE the LLM call, not after. Checking afterwards would still
  // spend the tokens and the latency it exists to prevent.
  if (pairing.last_draft_at) {
    const elapsed = Date.now() - new Date(pairing.last_draft_at).getTime()
    if (elapsed < RATE_LIMIT_MS) {
      return new Response(
        JSON.stringify({
          error: "too_many_requests",
          retry_after_ms: RATE_LIMIT_MS - elapsed,
        }),
        { status: 429, headers: jsonHeaders }
      )
    }
  }

  // Ownership: service role bypasses RLS, so scoping to user_id is the only
  // thing stopping a caller from drafting against someone else's lead. A
  // missing row and someone else's row are indistinguishable to the caller.
  const { data: lead } = await supabase
    .from("leads")
    .select("name, company, role, match_reasons")
    .eq("id", lead_id)
    .eq("user_id", user_id)
    .maybeSingle()

  if (!lead) {
    return new Response(JSON.stringify({ error: "lead_not_found" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  const { data: icp } = await supabase
    .from("icps")
    .select("target_roles, company_types, pain_points")
    .eq("user_id", user_id)
    .maybeSingle()

  if (!icp) {
    return new Response(JSON.stringify({ error: "no_icp" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  // Stamp the limit before the call. If the LLM hangs and the client retries,
  // the retry must be refused rather than starting a second inference.
  await supabase
    .from("extension_pairings")
    .update({ last_draft_at: new Date().toISOString() })
    .eq("device_token", device_token)

  let draft: Draft
  try {
    // callLLMJson has no timeout of its own, and an unresolved fetch here means
    // a button that spins forever. Race it.
    draft = await Promise.race([
      callLLMJson<Draft>({
        messages: [{ role: "user", content: draftPrompt(icp as Icp, lead as Lead) }],
        schema: DRAFT_SCHEMA,
        schemaName: "draft_opener",
        maxTokens: 512,
        // Reasoning stays disabled: it spends max_tokens on chain-of-thought
        // and truncates the JSON.
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("llm_timeout")), LLM_TIMEOUT_MS)
      ),
    ])
  } catch (err) {
    // 502, deliberately, not 500. It tells the panel "the model failed, use
    // your fallback" — show the lead's match_reasons verbatim. The user still
    // gets something to send.
    console.error("Glint: draft-opener LLM call failed", err)
    return new Response(JSON.stringify({ error: "llm_unavailable" }), {
      status: 502,
      headers: jsonHeaders,
    })
  }

  const opener = (draft.opener ?? "").trim()
  if (!opener) {
    return new Response(JSON.stringify({ error: "llm_unavailable" }), {
      status: 502,
      headers: jsonHeaders,
    })
  }

  // The model is asked for <=400 chars and usually obeys. Truncating on a word
  // boundary is better than pasting a sentence that stops mid-word.
  const capped =
    opener.length <= MAX_OPENER_CHARS
      ? opener
      : opener.slice(0, opener.lastIndexOf(" ", MAX_OPENER_CHARS)) + "…"

  return new Response(JSON.stringify({ opener: capped }), { headers: jsonHeaders })
})
