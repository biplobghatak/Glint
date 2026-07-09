import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function makeDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  let body: { pairing_code?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const code = body.pairing_code?.trim().toUpperCase()
  if (!code) {
    return new Response(JSON.stringify({ error: "missing_code" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { data: row } = await admin
    .from("extension_pairings")
    .select("id, expires_at, paired_at, site_id")
    .eq("pairing_code", code)
    .maybeSingle()

  if (
    !row ||
    row.paired_at !== null ||
    new Date(row.expires_at).getTime() < Date.now()
  ) {
    return new Response(JSON.stringify({ error: "invalid_code" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  const device_token = makeDeviceToken()
  const { error } = await admin
    .from("extension_pairings")
    .update({ device_token, paired_at: new Date().toISOString() })
    .eq("id", row.id)

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  // The panel keys its token map by site, and labels the switcher with the name.
  // Fetched separately rather than embedded: `sites` is reached through a
  // COMPOSITE foreign key (site_id, user_id), which PostgREST will not resolve
  // as an embed.
  const { data: site } = await admin
    .from("sites")
    .select("id, name, website_url")
    .eq("id", row.site_id)
    .maybeSingle()

  // `device_token` stays top-level: older panels read exactly that field.
  return new Response(JSON.stringify({ device_token, site }), {
    headers: jsonHeaders,
  })
})
