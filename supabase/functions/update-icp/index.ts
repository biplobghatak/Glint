import { createClient } from "jsr:@supabase/supabase-js@2"

// Lets the panel write the user's score threshold without a Supabase JWT.
// Resolves user_id server-side from the device_token; never accepts a
// client-supplied user_id.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { device_token?: string; min_score?: number }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token, min_score } = body
  if (!device_token || typeof min_score !== "number" || !Number.isFinite(min_score)) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  // icps.min_score carries a `check (min_score between 0 and 100)`. Clamping
  // here turns a malformed client into a no-op rather than a 500.
  const clamped = Math.min(Math.max(Math.floor(min_score), 0), 100)

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

  // UPDATE, not upsert, and naming exactly one column. icps.user_id is unique,
  // so an upsert here would have to supply every other column or reset them;
  // the threshold must never be able to clobber target_roles or
  // target_countries on its way in.
  const { data: updated, error } = await supabase
    .from("icps")
    .update({ min_score: clamped })
    .eq("user_id", pairing.user_id)
    .select("min_score")
    .maybeSingle()

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
  // No icps row: the user hasn't onboarded. There is no threshold to set, and
  // creating a bare icps row here would make has_icp true for a user with no
  // ICP, sending the panel past its onboarding prompt into an empty list.
  if (!updated) {
    return new Response(JSON.stringify({ error: "no_icp" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ min_score: updated.min_score }), {
    headers: jsonHeaders,
  })
})
