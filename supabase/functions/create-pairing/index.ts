import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I,O,0,1
const CODE_LENGTH = 8
const TTL_MS = 10 * 60 * 1000

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let out = ""
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get("Authorization") ?? ""

  // Identify the caller from their JWT using an anon client bound to the header.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()

  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // A pairing code is minted for one SITE. The resulting device_token is what
  // every other function resolves a site from, so a site_id from the request
  // body is untrusted until it is proven to belong to this JWT's user.
  let requested_site_id: string | undefined
  try {
    const body = await req.json()
    requested_site_id = body?.site_id
  } catch {
    // No body. Callers that predate multi-site send none; fall through to the
    // single-site default below.
  }

  const { data: sites } = await admin
    .from("sites")
    .select("id")
    .eq("user_id", user.id)

  const owned = (sites ?? []).map((s) => s.id as string)

  if (requested_site_id && !owned.includes(requested_site_id)) {
    // Indistinguishable from a site that does not exist.
    return new Response(JSON.stringify({ error: "site_not_found" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  // Omitting site_id is only unambiguous when the user has exactly one site.
  // That keeps every pre-multi-site caller working, and refuses to guess once
  // a second website exists rather than silently pairing to the wrong one.
  const site_id = requested_site_id ?? (owned.length === 1 ? owned[0] : undefined)

  if (!site_id) {
    return new Response(
      JSON.stringify({ error: owned.length === 0 ? "no_site" : "site_required" }),
      { status: 400, headers: jsonHeaders }
    )
  }

  const pairing_code = makeCode()
  const expires_at = new Date(Date.now() + TTL_MS).toISOString()

  const { error } = await admin.from("extension_pairings").insert({
    user_id: user.id,
    site_id,
    pairing_code,
    expires_at,
  })

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ pairing_code, expires_at, site_id }), {
    headers: jsonHeaders,
  })
})
