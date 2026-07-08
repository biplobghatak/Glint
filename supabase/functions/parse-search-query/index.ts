import { createClient } from "jsr:@supabase/supabase-js@2"
import { callLLMJson } from "../_shared/llm.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

type Icp = {
  target_roles: string[] | null
  company_types: string[] | null
  pain_points: string[] | null
  raw_summary: string | null
}

type ParsedQuery = {
  title: string
  keywords: string
  location: string
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    keywords: { type: "string" },
    location: { type: "string" },
  },
  required: ["title", "keywords", "location"],
  additionalProperties: false,
}

function parsePrompt(query: string, icp: Icp): string {
  return [
    "You convert a seller's natural-language request into LinkedIn people-search parameters.",
    "LinkedIn search supports two fields: an exact job `title` filter, and a free-text `keywords` string.",
    'Only put a value in `title` if the request names a canonical LinkedIn job title (e.g. "CEO", "Founder", "Product Manager"). Leave `title` as an empty string if the request describes a persona rather than a real title (e.g. "ecomm shop owner") — put that in `keywords` instead, as an OR-combined phrase (e.g. "ecommerce OR shopify OR DTC" combined with "founder OR owner").',
    "Extract a `location` if one is mentioned in the request, otherwise leave it as an empty string.",
    "Use the seller's ICP below as extra context to sharpen `keywords`, but the request itself is the primary source of truth for who to search for.",
    "",
    "Request:",
    query,
    "",
    "Seller ICP:",
    `- Target roles: ${(icp.target_roles ?? []).join(", ") || "n/a"}`,
    `- Company types: ${(icp.company_types ?? []).join(", ") || "n/a"}`,
    `- Summary: ${icp.raw_summary ?? "n/a"}`,
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

  let body: { query?: string; device_token?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { query, device_token } = body
  if (!device_token || !query || !query.trim()) {
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

  const { data: icp, error: icpError } = await supabase
    .from("icps")
    .select("target_roles, company_types, pain_points, raw_summary")
    .eq("user_id", user_id)
    .maybeSingle()

  if (icpError) {
    return new Response(JSON.stringify({ error: String(icpError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
  if (!icp) {
    return new Response(JSON.stringify({ error: "no_icp" }), {
      status: 404,
      headers: jsonHeaders,
    })
  }

  try {
    const parsed = await callLLMJson<ParsedQuery>({
      schema: QUERY_SCHEMA,
      schemaName: "search_query",
      maxTokens: 256,
      messages: [{ role: "user", content: parsePrompt(query.trim(), icp as Icp) }],
    })
    return new Response(JSON.stringify(parsed), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
})
