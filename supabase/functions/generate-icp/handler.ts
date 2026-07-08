import { callLLMJson } from "../_shared/llm.ts"

export const MIN_CONTENT_LENGTH = 200

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

async function fetchSiteText(url: string): Promise<string> {
  const base = Deno.env.get("CRAWL_SERVICE_URL")
  const secret = Deno.env.get("CRAWL_SERVICE_SECRET")
  if (!base || !secret) {
    console.error("CRAWL_SERVICE_URL or CRAWL_SERVICE_SECRET not configured")
    return ""
  }
  try {
    const res = await fetch(`${base}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawl-Secret": secret,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.error(`crawl-service returned ${res.status}`)
      return ""
    }
    const data = await res.json()
    return typeof data?.content === "string" ? data.content : ""
  } catch (err) {
    console.error(`crawl-service call failed: ${String(err)}`)
    return ""
  }
}

type IcpResult = {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
}

const ICP_SCHEMA = {
  type: "object",
  properties: {
    target_roles: { type: "array", items: { type: "string" } },
    company_types: { type: "array", items: { type: "string" } },
    pain_points: { type: "array", items: { type: "string" } },
    raw_summary: { type: "string" },
  },
  required: ["target_roles", "company_types", "pain_points", "raw_summary"],
  additionalProperties: false,
}

function generateIcp(content: string): Promise<IcpResult> {
  return callLLMJson<IcpResult>({
    schema: ICP_SCHEMA,
    schemaName: "icp",
    messages: [
      {
        role: "user",
        content: `Based on this website/product content, identify the ideal customer profile (ICP): target roles who'd buy this, the types of companies that fit, their pain points this product solves, and a short summary.\n\nContent:\n${content}`,
      },
    ],
  })
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
    return new Response(JSON.stringify(icp), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    })
  }
}
