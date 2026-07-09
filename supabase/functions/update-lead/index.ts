import { createClient } from "jsr:@supabase/supabase-js@2"

// Lets the panel change a lead's status or folder without a Supabase JWT.
// Resolves user_id server-side from the device_token; never accepts a
// client-supplied user_id.
//
// This function runs as the service role, which bypasses RLS entirely. Every
// ownership check below is therefore load-bearing: there is no policy behind
// them to catch a mistake.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const VALID_STATUSES = new Set(["new", "contacted", "ignored"])

type LeadPatch = { status?: unknown; folder_id?: unknown }

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { device_token?: string; lead_id?: string; patch?: LeadPatch }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token, lead_id } = body
  const patch = body.patch
  if (
    !device_token ||
    typeof lead_id !== "string" ||
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  // Only these two columns are writable through this endpoint. Anything else in
  // the patch is a client bug or an attack, and silently ignoring it would let
  // a future caller believe it had written user_id or match_score.
  const update: { status?: string; folder_id?: string | null } = {}

  if (has(patch, "status")) {
    if (typeof patch.status !== "string" || !VALID_STATUSES.has(patch.status)) {
      return new Response(JSON.stringify({ error: "invalid_status" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    update.status = patch.status
  }

  // `folder_id: null` is "unfile", a legitimate operation, and it is NOT the
  // same as omitting the key. `if (patch.folder_id)` treats both as falsy and
  // silently drops the unfile.
  const unfiling = has(patch, "folder_id") && patch.folder_id === null
  if (has(patch, "folder_id")) {
    if (patch.folder_id !== null && typeof patch.folder_id !== "string") {
      return new Response(JSON.stringify({ error: "invalid_folder_id" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    update.folder_id = patch.folder_id as string | null
  }

  if (Object.keys(update).length === 0) {
    return new Response(JSON.stringify({ error: "empty_patch" }), {
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

  // Authorization check 2 of 2: the target folder must belong to the same user.
  // Skipped when unfiling, because null names no folder. Without this a caller
  // could file their own lead into another user's folder id — the FK would
  // accept it and RLS, bypassed by the service role, would not object.
  if (!unfiling && typeof update.folder_id === "string") {
    const { data: folder } = await supabase
      .from("folders")
      .select("id")
      .eq("id", update.folder_id)
      .eq("user_id", user_id)
      .maybeSingle()

    if (!folder) {
      return new Response(JSON.stringify({ error: "folder_not_found" }), {
        status: 404,
        headers: jsonHeaders,
      })
    }
  }

  // Authorization check 1 of 2: the lead must belong to the resolved user.
  // Expressed as a predicate on the UPDATE rather than a prior SELECT, so the
  // check and the write cannot race. No matched row means the lead is missing
  // or someone else's — the caller learns nothing about which.
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
    return new Response(JSON.stringify({ error: "lead_not_found" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders })
})
