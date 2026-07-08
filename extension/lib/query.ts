import { getDeviceToken } from "@/lib/pairing"

const env = import.meta.env as unknown as Record<string, string>

export type ParsedQuery = { title: string; keywords: string; location: string }

export class UnpairedError extends Error {}
export class NoIcpError extends Error {}
export class QueryServiceError extends Error {}

export async function parseQuery(query: string): Promise<ParsedQuery> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new UnpairedError("not paired")

  const res = await fetch(
    `${env.WXT_SUPABASE_URL}/functions/v1/parse-search-query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.WXT_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ device_token, query }),
    }
  )

  if (res.status === 401) throw new UnpairedError("unpaired")
  if (res.status === 404) throw new NoIcpError("no_icp")
  if (!res.ok) throw new QueryServiceError(`parse-search-query failed (${res.status})`)

  return (await res.json()) as ParsedQuery
}

export function buildSearchUrl(parsed: ParsedQuery): string {
  const params = new URLSearchParams()
  const kw = [parsed.keywords, parsed.location]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim()
  if (kw) params.set("keywords", kw)
  if (parsed.title && parsed.title.trim()) params.set("title", parsed.title.trim())
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}
