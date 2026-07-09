import { callLLMJson } from "../_shared/llm.ts"

export const MIN_CONTENT_LENGTH = 200

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

async function fetchSiteText(url: string): Promise<string> {
  const base = Deno.env.get("CRAWL_SERVICE_URL")
  const token = Deno.env.get("CRAWL_SERVICE_SECRET")
  if (!base || !token) {
    console.error("CRAWL_SERVICE_URL or CRAWL_SERVICE_SECRET not configured")
    return ""
  }
  try {
    const res = await fetch(`${base}/md`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.error(`crawl4ai service returned ${res.status}`)
      return ""
    }
    const data = await res.json()
    return data?.success && typeof data?.markdown === "string" ? data.markdown : ""
  } catch (err) {
    console.error(`crawl4ai service call failed: ${String(err)}`)
    return ""
  }
}

type IcpResult = {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
  target_countries: string[]
}

// OpenRouter's strict json_schema with additionalProperties:false requires
// EVERY property to appear in `required`. target_countries is therefore
// required-but-possibly-empty rather than optional; an empty array means "no
// geographic preference", which every consumer reads as "match all countries".
const ICP_SCHEMA = {
  type: "object",
  properties: {
    target_roles: { type: "array", items: { type: "string" } },
    company_types: { type: "array", items: { type: "string" } },
    pain_points: { type: "array", items: { type: "string" } },
    raw_summary: { type: "string" },
    target_countries: { type: "array", items: { type: "string" } },
  },
  required: [
    "target_roles",
    "company_types",
    "pain_points",
    "raw_summary",
    "target_countries",
  ],
  additionalProperties: false,
}

function generateIcp(content: string): Promise<IcpResult> {
  return callLLMJson<IcpResult>({
    schema: ICP_SCHEMA,
    schemaName: "icp",
    messages: [
      {
        role: "user",
        content: `Based on this website/product content, identify the ideal customer profile (ICP): target roles who'd buy this, the types of companies that fit, their pain points this product solves, and a short summary.

Also return target_countries: the countries this product sells into, as ISO-3166 alpha-2 codes (e.g. US, GB, DE). Return an empty array unless the content names specific markets — an empty array means "sells everywhere", and inventing countries would silently filter real leads out of the user's list.

Content:\n${content}`,
      },
    ],
  })
}

// The model is told to emit alpha-2 codes but the schema only constrains the
// type. Drop anything that isn't exactly two letters, and dedupe: a bad code
// here becomes a country filter that matches nothing.
export function normalizeCountries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const codes = raw
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
  return Array.from(new Set(codes))
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const { website_url, fallback_text } = await req.json()

  let content: string
  if (typeof fallback_text === "string" && fallback_text.trim().length > 0) {
    content = fallback_text.trim()
  } else {
    const scraped = await fetchSiteText(website_url)
    if (scraped.length < MIN_CONTENT_LENGTH) {
      return new Response(JSON.stringify({ needs_manual_input: true }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      })
    }
    content = scraped
  }

  try {
    const icp = await generateIcp(content)
    const normalized: IcpResult = {
      ...icp,
      target_countries: normalizeCountries(icp.target_countries),
    }
    return new Response(JSON.stringify(normalized), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
}
