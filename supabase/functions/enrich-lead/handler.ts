import { createClient } from "jsr:@supabase/supabase-js@2"

// Writes profile enrichment (avatar, email, phone) onto an existing lead.
// Mirrors update-lead's auth and ownership scoping: this function runs as the
// service role, which bypasses RLS entirely, so the `.eq("user_id", user_id)`
// on the UPDATE below is the ONLY barrier stopping a leaked device_token from
// writing enrichment onto a stranger's lead. A lead that exists but belongs to
// someone else must be indistinguishable from one that does not exist.
//
// `enriched_at` is always stamped, even when avatar_url/email/phone are all
// absent or null -- see the migration's comment. Without it, a null `email`
// is permanently ambiguous between "we looked and there is no public email"
// and "we have never looked". Every successful call means "we looked".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
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
    device_token?: string
    lead_id?: string
    avatar_url?: unknown
    email?: unknown
    phone?: unknown
  }
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

  // Only these three columns are writable through this endpoint, and only when
  // the key is present in the body -- an absent key must leave the existing
  // value alone, not overwrite it with null. `enriched_at` is unconditional:
  // it is set below regardless of what (if anything) the caller sent.
  const update: {
    avatar_url?: string | null
    email?: string | null
    phone?: string | null
    enriched_at: string
  } = {
    enriched_at: new Date().toISOString(),
  }

  if (has(body, "avatar_url")) {
    if (body.avatar_url !== null && typeof body.avatar_url !== "string") {
      return new Response(JSON.stringify({ error: "invalid_avatar_url" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    update.avatar_url = body.avatar_url as string | null
  }
  if (has(body, "email")) {
    if (body.email !== null && typeof body.email !== "string") {
      return new Response(JSON.stringify({ error: "invalid_email" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    update.email = body.email as string | null
  }
  if (has(body, "phone")) {
    if (body.phone !== null && typeof body.phone !== "string") {
      return new Response(JSON.stringify({ error: "invalid_phone" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    update.phone = body.phone as string | null
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

  // Authorization check: the lead must belong to the resolved user. Expressed
  // as a predicate on the UPDATE rather than a prior SELECT, so the check and
  // the write cannot race. No matched row means the lead is missing or
  // someone else's -- the caller learns nothing about which.
  const { data: updated, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", lead_id)
    .eq("user_id", user_id)
    .select("id")
    .maybeSingle()

  if (error) {
    return new Response(JSON.stringify({ error: String(error.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
  if (!updated) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders })
}
