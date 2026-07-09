import { createClient } from "jsr:@supabase/supabase-js@2"

// The extension holds an opaque device_token, never a Supabase JWT. Every RLS
// policy on `folders` is `auth.uid() = user_id`, so a supabase-js query from the
// panel returns zero rows — silently, with no error. This function resolves
// user_id server-side from extension_pairings under the service role, and never
// accepts a client-supplied user_id.
//
// Rename and delete are deliberately absent: they live in the web app. The panel
// is a working surface (find leads, file them), not a management surface.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

const MAX_NAME_LENGTH = 60

type FolderRow = { id: string; name: string; lead_count: number }

// Postgres reports a `folders_user_name_idx` violation as 23505. The index is on
// (user_id, lower(name)), so this is the case-insensitive duplicate, and the
// user must be told which name collided rather than shown a 500.
const UNIQUE_VIOLATION = "23505"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: { device_token?: string; action?: string; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token, action } = body
  if (!device_token || (action !== "list" && action !== "create")) {
    return new Response(JSON.stringify({ error: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // Fails closed: a revoked pairing has no row, so it reads nothing.
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

  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) {
      return new Response(JSON.stringify({ error: "Folder name can't be empty" }), {
        status: 400,
        headers: jsonHeaders,
      })
    }
    if (name.length > MAX_NAME_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Folder name must be ${MAX_NAME_LENGTH} characters or fewer` }),
        { status: 400, headers: jsonHeaders }
      )
    }

    const { error } = await supabase.from("folders").insert({ user_id, name })

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return new Response(
          JSON.stringify({ error: `A folder named "${name}" already exists` }),
          { status: 409, headers: jsonHeaders }
        )
      }
      return new Response(JSON.stringify({ error: String(error.message) }), {
        status: 500,
        headers: jsonHeaders,
      })
    }
  }

  // Both actions answer with the full post-mutation list, so the panel never has
  // to merge a newly created folder into its own state by hand.
  const { data, error: listError } = await supabase.rpc("folders_with_counts", {
    p_user_id: user_id,
  })

  if (listError) {
    return new Response(JSON.stringify({ error: String(listError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  // lead_count comes back from Postgres as a bigint, which PostgREST serializes
  // as a JSON number here but a string in some drivers; Number() pins it.
  const folders: FolderRow[] = (data ?? []).map(
    (f: { id: string; name: string; lead_count: number | string }) => ({
      id: f.id,
      name: f.name,
      lead_count: Number(f.lead_count),
    })
  )

  return new Response(JSON.stringify({ folders }), {
    status: action === "create" ? 201 : 200,
    headers: jsonHeaders,
  })
})
