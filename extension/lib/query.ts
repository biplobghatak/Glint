import { getDeviceToken } from "@/lib/pairing"

const env = import.meta.env as unknown as Record<string, string>

export type ParsedQuery = { title: string; keywords: string; location: string }

export class UnpairedError extends Error {}
export class NoIcpError extends Error {}
export class QueryServiceError extends Error {}
// Thrown only when fetch() itself rejects (DNS failure, connection refused,
// offline, etc). fetch rejects with a TypeError exclusively for genuine
// transport failures, so it's sound to infer "network error" here, at the
// call site — unlike inferring it from a bare `instanceof TypeError` far
// away in the caller, which would also catch unrelated bugs (e.g. reading a
// property of undefined after a malformed 200 response).
export class NetworkError extends Error {}

function isParsedQuery(value: unknown): value is ParsedQuery {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.title === "string" &&
    typeof v.keywords === "string" &&
    typeof v.location === "string"
  )
}

export async function parseQuery(query: string): Promise<ParsedQuery> {
  const device_token = await getDeviceToken()
  if (!device_token) throw new UnpairedError("not paired")

  let res: Response
  try {
    res = await fetch(
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
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : "fetch failed"
    )
  }

  if (res.status === 401) throw new UnpairedError("unpaired")
  if (res.status === 404) throw new NoIcpError("no_icp")
  if (!res.ok) throw new QueryServiceError(`parse-search-query failed (${res.status})`)

  // A 200 with a non-JSON body (crashed function, proxy error page) throws a
  // SyntaxError here. Left unguarded it reaches the caller as an unclassified
  // error and gets reported as a parse failure — the same misleading message
  // the typed errors exist to avoid.
  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    throw new QueryServiceError(
      `parse-search-query returned a non-JSON body: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
  if (!isParsedQuery(body)) {
    throw new QueryServiceError(
      "parse-search-query returned a malformed response (expected {title, keywords, location} strings)"
    )
  }
  return body
}

/**
 * `page` is a URL parameter, not a button. LinkedIn's class names and
 * aria-labels rotate; a query-string parameter does not. The previous
 * implementation clicked a "Next" button whose selectors this file's own
 * comments admitted were unverified, and silently fell back to a scroll when
 * they missed -- which is why runs never left page 1.
 */
export function buildSearchUrl(parsed: ParsedQuery, page = 1): string {
  const params = new URLSearchParams()
  const kw = [parsed.keywords, parsed.location]
    .filter((s) => s && s.trim())
    .join(" ")
    .trim()
  if (kw) params.set("keywords", kw)
  if (parsed.title && parsed.title.trim()) params.set("title", parsed.title.trim())
  if (page > 1) params.set("page", String(page))
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}
