const MIN_CONTENT_LENGTH = 200
const CLAUDE_MODEL = "claude-opus-4-8"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchSiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return ""
    const html = await res.text()
    return stripHtml(html)
  } catch {
    return ""
  }
}

type IcpResult = {
  target_roles: string[]
  company_types: string[]
  pain_points: string[]
  raw_summary: string
}

async function generateIcp(content: string): Promise<IcpResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              target_roles: { type: "array", items: { type: "string" } },
              company_types: { type: "array", items: { type: "string" } },
              pain_points: { type: "array", items: { type: "string" } },
              raw_summary: { type: "string" },
            },
            required: [
              "target_roles",
              "company_types",
              "pain_points",
              "raw_summary",
            ],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: `Based on this website/product content, identify the ideal customer profile (ICP): target roles who'd buy this, the types of companies that fit, their pain points this product solves, and a short summary.\n\nContent:\n${content}`,
        },
      ],
    }),
  })

  const data = await response.json()
  if (!response.ok || data.stop_reason === "refusal") {
    throw new Error(`Claude request failed: ${JSON.stringify(data)}`)
  }

  return JSON.parse(data.content[0].text) as IcpResult
}

Deno.serve(async (req: Request) => {
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
})
