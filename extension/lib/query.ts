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
// A top-level ` OR ` between the model's alternatives. Uppercase is required:
// LinkedIn treats a lowercase `or` as an ordinary search word.
const OR_SEPARATOR = /\s+OR\s+/

/**
 * One search term, quoted iff it is a phrase.
 *
 * LinkedIn ANDs the words of an unquoted phrase, so a bare `agency owner` means
 * `agency AND owner` and drifts onto anyone whose profile happens to contain
 * both words. A single word is left alone: quoting it would suppress LinkedIn's
 * stemming for no benefit.
 */
function quoteTerm(raw: string): string {
  const t = raw.trim()
  if (!t) return ""
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) return t
  if (!/\s/.test(t)) return t
  // An interior quote would close the phrase early and hand LinkedIn a
  // malformed expression. There is nothing useful to escape it to.
  return `"${t.replace(/"/g, " ").replace(/\s+/g, " ").trim()}"`
}

/**
 * The `keywords` value: the model's alternatives, grouped, ANDed with the
 * location.
 *
 * This function exists because of a live bug. `location` used to be appended to
 * `keywords` with a space, and LinkedIn's boolean parser binds implicit AND
 * tighter than OR — so
 *
 *     agency owner OR agency partner OR agency founder United Kingdom
 *
 * parsed as `A OR B OR (C AND United AND Kingdom)`. Only the LAST alternative
 * was constrained to the UK, and none of the phrases were quoted. The search
 * returned agency owners anywhere on earth, exactly as asked, for a query the
 * user never wrote.
 *
 * So the OR group is parenthesised, every phrase is quoted, and the location is
 * joined with an explicit AND. `location` is still matched as TEXT, not as
 * LinkedIn's geography facet — a profile reading "clients across the United
 * Kingdom" still matches. Narrowing that needs `geoUrn` and a resolved geo id;
 * see the spec.
 */
export function composeKeywords(keywords: string, location: string): string {
  const kw = keywords.trim()
  const loc = quoteTerm(location)

  let expr = ""
  if (kw) {
    // The model was allowed to group its own alternatives. If it did, its
    // grouping is authoritative and re-splitting on ` OR ` would shred it.
    if (kw.includes("(")) {
      expr = kw
    } else {
      const terms = kw.split(OR_SEPARATOR).map(quoteTerm).filter(Boolean)
      expr = terms.join(" OR ")
      if (terms.length > 1) expr = `(${expr})`
    }
  }

  if (!expr) return loc
  if (!loc) return expr
  return `${expr} AND ${loc}`
}

export function buildSearchUrl(parsed: ParsedQuery, page = 1): string {
  const params = new URLSearchParams()
  const kw = composeKeywords(parsed.keywords, parsed.location)
  if (kw) params.set("keywords", kw)
  if (parsed.title && parsed.title.trim()) params.set("title", parsed.title.trim())
  if (page > 1) params.set("page", String(page))
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}

const SEARCH_RESULTS_PATH = "/search/results/people/"

/**
 * True when `href` IS the page the run expects to be scanning right now.
 *
 * The run no longer opens its own window -- it adopts the LinkedIn tab the user
 * is already on -- so `glint_run` is written into a tab that already has a live
 * content script sitting on some *other* page. That write fires
 * storage.onChanged, which would drive the page step immediately, before the
 * navigation to the search URL has gone anywhere. On the feed that stops the run
 * with "couldn't find result cards"; on someone else's search results it
 * silently scores the wrong query's cards.
 *
 * So the run's tab drives only the page the run expects. Written against
 * buildSearchUrl above, which is what "expected" means: same pathname, same
 * keywords, same title, same page. Compared parameter-wise rather than as
 * strings because LinkedIn appends its own tracking params on navigation, and a
 * byte comparison would call the run's own page foreign the moment it lands.
 */
export function isRunPage(parsed: ParsedQuery, page: number, href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.pathname !== SEARCH_RESULTS_PATH) return false

  const expected = new URL(buildSearchUrl(parsed, page))
  for (const key of ["keywords", "title"] as const) {
    if (url.searchParams.get(key) !== expected.searchParams.get(key)) return false
  }
  // buildSearchUrl omits `page` entirely for page 1, and LinkedIn serves page 1
  // at both `?page=1` and no page param at all. Absent must therefore equal 1,
  // or a run resumed onto an explicit `?page=1` URL would never drive.
  return (url.searchParams.get("page") ?? "1") === (expected.searchParams.get("page") ?? "1")
}
