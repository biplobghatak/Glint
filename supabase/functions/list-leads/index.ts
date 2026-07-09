import { createClient } from "jsr:@supabase/supabase-js@2"

// The extension holds an opaque device_token, never a Supabase JWT. Every RLS
// policy on `leads` is `auth.uid() = user_id`, so a supabase-js query from the
// panel returns zero rows — silently, with no error. This function exists so
// the panel can read leads at all: it resolves user_id server-side from
// extension_pairings under the service role, and never accepts a client-
// supplied user_id.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

// Mirrors icps.min_score's column default, for the user who has no icps row yet.
const DEFAULT_MIN_SCORE = 70
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 25

type SortKey = "score_desc" | "score_asc" | "newest" | "oldest"

type LeadFilter = {
  q: string
  countries: string[]
  folderId: string | null
  status: ("new" | "contacted" | "ignored")[]
  minScore: number | null
  sort: SortKey
}

// Keyset cursor. `match_score` and `created_at` are both carried because the
// sort key differs per sort mode and the cursor must name whichever column is
// ordering the page. `id` is the tiebreak that makes the ordering total.
type Cursor = {
  match_score: number | null
  created_at: string | null
  id: string
}

const SORTS: Record<SortKey, { col: "match_score" | "created_at"; asc: boolean }> = {
  score_desc: { col: "match_score", asc: false },
  score_asc: { col: "match_score", asc: true },
  newest: { col: "created_at", asc: false },
  oldest: { col: "created_at", asc: true },
}

const LEAD_COLUMNS =
  "id, name, company, role, linkedin_url, location, country, match_score, match_reasons, status, created_at"

const VALID_STATUSES = new Set(["new", "contacted", "ignored"])

// The subset of supabase-js's filter builder that applyCommonFilters() needs.
// Each method returns `this` on the real builder, so `T extends CommonFilters<T>`
// binds to both the row-select and the head-count builders.
interface CommonFilters<T> {
  eq(column: string, value: unknown): T
  in(column: string, values: readonly unknown[]): T
  is(column: string, value: unknown): T
  or(filters: string): T
}

// PostgREST parses `or=(...)` as a grammar: commas separate terms, parentheses
// group them, and a double quote opens a quoted value. A raw user query
// containing any of those changes the *shape* of the filter rather than the
// text being matched, so strip them before interpolation. `%` and `*` are
// ilike wildcards — a stray one turns a search into "match everything".
function sanitizeQuery(q: unknown): string {
  if (typeof q !== "string") return ""
  return q.replace(/[,()"'\\%*.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
}

function clampLimit(limit: unknown): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT
  return Math.min(Math.max(n, 1), MAX_LIMIT)
}

function normalizeCountries(raw: unknown): { codes: string[]; unknown: boolean } {
  if (!Array.isArray(raw)) return { codes: [], unknown: false }
  const codes: string[] = []
  let unknown = false
  for (const c of raw) {
    if (typeof c !== "string") continue
    // "" is the Unknown chip: every lead scored before the country migration
    // has country = null, forever. It maps to `country is null`, not to a code.
    if (c === "") {
      unknown = true
      continue
    }
    const code = c.trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(code)) codes.push(code)
  }
  return { codes: Array.from(new Set(codes)), unknown }
}

function cursorValue(cursor: Cursor, col: "match_score" | "created_at"): string | number | null {
  return col === "match_score" ? cursor.match_score : cursor.created_at
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, "content-type": "application/json" }

  let body: {
    device_token?: string
    filter?: Partial<LeadFilter>
    cursor?: Cursor | null
    limit?: number
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    })
  }

  const { device_token } = body
  if (!device_token) {
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

  const { data: icp } = await supabase
    .from("icps")
    .select("min_score, target_countries")
    .eq("user_id", user_id)
    .maybeSingle()

  const has_icp = !!icp
  const min_score = icp?.min_score ?? DEFAULT_MIN_SCORE
  // Seeds the panel's country chips. Postgres has no cheap DISTINCT through
  // PostgREST, and scanning every lead's country to build the chip list would
  // reintroduce the unbounded fetch this function exists to avoid. The ICP's
  // target geography is the right seed set anyway: it's what the user said they
  // sell into. The panel unions it with the countries actually present on the
  // rows it has loaded.
  const target_countries: string[] = icp?.target_countries ?? []

  const filter = body.filter ?? {}
  const q = sanitizeQuery(filter.q)
  const { codes, unknown } = normalizeCountries(filter.countries)
  const statuses = Array.isArray(filter.status)
    ? filter.status.filter((s) => VALID_STATUSES.has(s))
    : []
  const sortKey: SortKey = filter.sort && filter.sort in SORTS ? filter.sort : "score_desc"
  const { col, asc } = SORTS[sortKey]
  const limit = clampLimit(body.limit)

  // filter.minScore === null means "use the user's saved threshold". A number
  // (including 0, which the panel sends when the user clicks "reveal") overrides
  // it for this request only and is never written back to icps.
  const threshold =
    typeof filter.minScore === "number" && Number.isFinite(filter.minScore)
      ? Math.min(Math.max(Math.floor(filter.minScore), 0), 100)
      : min_score

  // Every filter EXCEPT the score threshold, so one predicate builds both the
  // page and the below-threshold count and the two can never drift apart.
  //
  // supabase-js's filter methods all return `this`, so a structural bound on
  // just the four we use types this helper without a cast at either call site.
  const applyCommonFilters = <T extends CommonFilters<T>>(builder: T): T => {
    let b = builder.eq("user_id", user_id)

    if (q) {
      b = b.or(`name.ilike.%${q}%,company.ilike.%${q}%,role.ilike.%${q}%`)
    }
    if (statuses.length > 0) {
      b = b.in("status", statuses)
    }
    // No country chips selected at all means no country filter — show
    // everything, NOT "match no country".
    if (codes.length > 0 && unknown) {
      b = b.or(`country.in.(${codes.join(",")}),country.is.null`)
    } else if (codes.length > 0) {
      b = b.in("country", codes)
    } else if (unknown) {
      b = b.is("country", null)
    }
    // Repeated `or=` params are ANDed by PostgREST, so the q filter, the
    // country filter, and the keyset filter below compose rather than clobber
    // one another.

    // NOTE: filter.folderId is deliberately ignored here. leads.folder_id does
    // not exist until Phase 2's migration, and naming a missing column makes
    // PostgREST 400 the whole request. The panel renders the folder control
    // disabled against this same LeadFilter object until then.
    return b
  }

  // `.gte` on a nullable column excludes NULLs, so a lead with match_score =
  // null never appears — correct, because such a lead was never scored, and an
  // unscored lead has no business in a list ranked by score. score-lead always
  // writes match_score, so this set is empty in practice.
  let query = applyCommonFilters(supabase.from("leads").select(LEAD_COLUMNS))
    .gte("match_score", threshold)
    .order(col, { ascending: asc, nullsFirst: false })
    .order("id", { ascending: true })

  const cursor = body.cursor ?? null
  if (cursor && typeof cursor.id === "string") {
    const v = cursorValue(cursor, col)
    // A null cursor value can't be compared against; serve the first page
    // instead of silently returning an empty one.
    if (v !== null && v !== undefined) {
      const op = asc ? "gt" : "lt"
      query = query.or(`${col}.${op}.${v},and(${col}.eq.${v},id.gt.${cursor.id})`)
    }
  }

  // Over-fetch by one to learn whether a further page exists without a second
  // count query.
  const { data: rows, error: rowsError } = await query.limit(limit + 1)

  if (rowsError) {
    return new Response(JSON.stringify({ error: String(rowsError.message) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  const page = (rows ?? []).slice(0, limit)
  const hasMore = (rows ?? []).length > limit
  const last = page[page.length - 1]
  const next_cursor =
    hasMore && last
      ? {
          match_score: last.match_score ?? null,
          created_at: last.created_at ?? null,
          id: last.id,
        }
      : null

  // How many leads the threshold is hiding, under the same q/country/status
  // filters. The panel renders this as "N leads below your threshold (70)"
  // with one click to reveal — a filter that hides rows without saying so is
  // indistinguishable from having no leads.
  const { count: belowCount } = await applyCommonFilters(
    supabase.from("leads").select("id", { count: "exact", head: true })
  ).lt("match_score", threshold)

  return new Response(
    JSON.stringify({
      leads: page,
      next_cursor,
      below_threshold_count: belowCount ?? 0,
      min_score,
      has_icp,
      target_countries,
    }),
    { headers: jsonHeaders }
  )
})
