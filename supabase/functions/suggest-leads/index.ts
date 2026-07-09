import { createClient } from "jsr:@supabase/supabase-js@2"

// Returns up to 6 leads worth acting on right now, for the side panel's
// suggestion strip. Device-token authenticated; resolves user_id server-side
// and never accepts a client-supplied one.
//
// Deliberately NOT an LLM call. Every lead here was already scored against
// this user's ICP by score-lead, and the score is stored. Re-asking a model to
// rank them would cost a round-trip on every panel open and, worse, reshuffle
// the list between opens for no reason the user could perceive. "Real-time,
// based on the user's ICP" is satisfied by reading fresh rows.
//
// Runs as the service role, which bypasses RLS: the user_id predicate below is
// the only thing scoping these rows, so it is load-bearing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const SUGGESTION_LIMIT = 6

// Mirrors icps.min_score's column default, for the vanishingly rare case of a
// paired user with no ICP row who somehow reaches this endpoint.
const DEFAULT_MIN_SCORE = 70

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { device_token?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token } = body
  if (!device_token) {
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

  const { data: icp } = await supabase
    .from("icps")
    .select("min_score, target_countries")
    .eq("user_id", user_id)
    .maybeSingle()

  // No ICP yet is an ordinary state for a freshly paired user, not an error.
  // The panel already knows how to prompt for onboarding (list-leads.has_icp);
  // 404ing here would make it show a failure instead.
  if (!icp) {
    return new Response(JSON.stringify({ suggestions: [] }), { headers: jsonHeaders })
  }

  const minScore = icp.min_score ?? DEFAULT_MIN_SCORE
  const targetCountries: string[] = icp.target_countries ?? []

  let query = supabase
    .from("leads")
    .select("id, name, company, role, linkedin_url, match_score, match_reasons")
    .eq("user_id", user_id)
    .eq("status", "new")
    // Untriaged, in both senses: not yet contacted, and not yet filed. Filing a
    // lead into a folder is the user acting on it, so it stops being something
    // Glint should keep suggesting. Without this the strip would re-offer a lead
    // the user just organized, and the refresh after an assign would be a no-op.
    .is("folder_id", null)
    .gte("match_score", minScore)
    // Both actions on a suggestion card are "open this URL". A row without one
    // is a dead card, so it is dropped here rather than rendered and disabled.
    .not("linkedin_url", "is", null)

  // An empty target_countries means "no geographic preference", which must show
  // every country — NOT match zero rows.
  //
  // When it is set, NULL countries stay eligible. `.in()` alone would drop
  // them, and every lead scored before the country column existed has
  // country = null — score-lead's dedup branch returns before scoring, so
  // ordinary browsing never backfills them. Excluding them would silently empty
  // the strip for every existing user. This mirrors list-leads, where "Unknown"
  // is a selectable, on-by-default chip for exactly the same reason.
  if (targetCountries.length > 0) {
    // ISO-3166 alpha-2, but quote anyway: an unquoted value in PostgREST's
    // filter grammar lets a comma or paren change what the expression means.
    const codes = targetCountries.map((c) => `"${c.replace(/["\\]/g, "")}"`).join(",")
    query = query.or(`country.in.(${codes}),country.is.null`)
  }

  const { data: suggestions, error } = await query
    .order("match_score", { ascending: false })
    .order("id", { ascending: true }) // total ordering, so ties don't reshuffle
    .limit(SUGGESTION_LIMIT)

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ suggestions: suggestions ?? [] }), {
    headers: jsonHeaders,
  })
})
