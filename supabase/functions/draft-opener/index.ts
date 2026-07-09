import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"
import { MAX_OPENER_CHARS, validateOpener } from "./validate.ts"

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

// OpenRouter runs strict json_schema with additionalProperties:false, which
// requires EVERY property to appear in `required`. Optionality is expressed as
// a nullable type, never by omitting a key.
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    opener: {
      type: "string",
      description:
        `A LinkedIn outreach opener, at most ${MAX_OPENER_CHARS} characters. Opens with a greeting: "Hi <first name>," (or "Hi there," if the name is unknown). Never a placeholder like [Name] or {{first_name}}. References one concrete match reason. No sign-off. No em dashes or en dashes. Must end with a call to action.`,
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

/**
 * The name to greet someone by.
 *
 * LinkedIn stores a display name ("Priya Sharma", sometimes "Dr. Alan Kay, PhD"),
 * and "Hi Priya Sharma," reads like a form letter. Take the first token and
 * nothing else. A model asked to do this itself will occasionally greet someone
 * by their surname or their credentials, so it is done here, not in the prompt.
 *
 * Returns null when there is no usable first name, which the prompt turns into
 * "Hi there," — never a placeholder the user has to find and replace.
 */
const HONORIFIC = /^(mr|mrs|ms|miss|dr|prof|sir|rev)$/i

function greetingName(name: string | null): string | null {
  for (const token of (name ?? "").trim().split(/\s+/)) {
    // A trailing period catches "Dr."; HONORIFIC catches the bare spellings.
    const word = token.replace(/[.,]+$/, "")
    if (!word || HONORIFIC.test(word)) continue
    return word
  }
  return null
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

  const greeting = greetingName(lead.name)
  const openingLine = greeting ? `Hi ${greeting},` : "Hi there,"

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
    `- Begin with exactly this greeting, on its own, before anything else: ${openingLine}`,
    "- Never invent a different greeting, and never use a placeholder like [Name] or {{first_name}}.",
    `- At most ${MAX_OPENER_CHARS} characters, greeting included.`,
    "- No em dashes (—) or en dashes (–). Use a period or comma instead.",
    "- End with a call to action: either a question, or an imperative like 'Let me know if you're open to a chat.'",
    "- Reference one concrete, specific reason this person is relevant.",
    "- No sign-off, no signature, no 'Best regards'.",
    "- Plain, direct, and human. No marketing adjectives. Do not claim you read something you did not.",
  ].join("\n")
}

// Turns a validator rejection reason into a sentence the model can act on.
// Named so the retry prompt can say exactly what was wrong, not just "invalid".
function violationDescription(reason: string): string {
  switch (reason) {
    case "too_long":
      return `it was over ${MAX_OPENER_CHARS} characters`
    case "dash":
      return "it used an em dash or en dash"
    case "no_cta":
      return "it did not end with a call to action"
    case "no_greeting":
      return "it did not begin with a greeting like 'Hi Priya,'"
    case "placeholder":
      return "it contained a placeholder token the sender would have to fill in"
    case "empty":
      return "it was empty"
    default:
      return "it did not meet the required format"
  }
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
    .select("user_id, site_id, last_draft_at")
    .eq("device_token", device_token)
    .maybeSingle()

  if (!pairing) {
    return new Response(JSON.stringify({ error: "unpaired" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  const user_id = pairing.user_id
  const site_id = pairing.site_id

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
    .eq("site_id", site_id)
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
    .eq("site_id", site_id)
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

  // callLLMJson has no timeout of its own, and an unresolved fetch here means a
  // button that spins forever. Race each attempt individually.
  async function requestOpener(prompt: string): Promise<string> {
    const draft = await Promise.race([
      callLLMJson<Draft>({
        messages: [{ role: "user", content: prompt }],
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
    return (draft.opener ?? "").trim()
  }

  const basePrompt = draftPrompt(icp as Icp, lead as Lead)

  let opener: string
  try {
    opener = await requestOpener(basePrompt)
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

  // The contract (<=200 chars, no em/en dash, ends with a call to action) is
  // enforced HERE, on the response, not just requested in the prompt. A model
  // told not to use an em dash will use one eventually. On failure, retry once
  // naming the specific violation; if the retry also fails, never ship an
  // invalid opener — fall back to 502 like any other LLM failure.
  let result = validateOpener(opener)
  if (!result.ok) {
    console.warn("Glint: draft-opener rejected draft", { reason: result.reason, text: opener })

    const retryPrompt = [
      basePrompt,
      "",
      `Your previous draft was rejected because ${violationDescription(result.reason)}: "${opener}"`,
      "Rewrite it so it satisfies every rule above.",
    ].join("\n")

    try {
      opener = await requestOpener(retryPrompt)
    } catch (err) {
      console.error("Glint: draft-opener retry LLM call failed", err)
      return new Response(JSON.stringify({ error: "llm_unavailable" }), {
        status: 502,
        headers: jsonHeaders,
      })
    }

    result = validateOpener(opener)
    if (!result.ok) {
      console.warn("Glint: draft-opener rejected retry draft", { reason: result.reason, text: opener })
      return new Response(JSON.stringify({ error: "llm_unavailable" }), {
        status: 502,
        headers: jsonHeaders,
      })
    }
  }

  return new Response(JSON.stringify({ opener }), { headers: jsonHeaders })
})
