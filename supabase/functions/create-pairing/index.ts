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

  const pairing_code = makeCode()
  const expires_at = new Date(Date.now() + TTL_MS).toISOString()

  const { error } = await admin.from("extension_pairings").insert({
    user_id: user.id,
    pairing_code,
    expires_at,
  })

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ pairing_code, expires_at }), {
    headers: jsonHeaders,
  })
})
