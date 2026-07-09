import { assertEquals } from "jsr:@std/assert@1"
import { handler } from "./handler.ts"

// A stored lead and a discarded one must be indistinguishable to the content
// script in every respect but `stored`. The badge is drawn from match_score,
// so a discarded lead that answered without one would leave an unexplained
// gap on the page -- the exact failure injectBadge's comment warns about.

type Existing = { id: string; match_score: number; match_reasons: string[] }

let insertedRows: unknown[] = []

function makeReq(body: unknown): Request {
  return new Request("http://localhost/score-lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function stubScoreLeadBackend(opts: {
  minScore: number
  llmScore?: number
  existingLead?: Existing | null
  folder?: { id: string; user_id: string } | null
}): () => void {
  insertedRows = []
  Deno.env.set("SUPABASE_URL", "http://db.test")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "k")
  Deno.env.set("OPENROUTER_API_KEY", "k")

  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/rest/v1/extension_pairings")) {
      return json([{ user_id: "u1" }])
    }
    if (url.includes("/rest/v1/folders")) {
      return json(opts.folder ? [opts.folder] : [])
    }
    if (url.includes("/rest/v1/leads") && method === "POST") {
      insertedRows.push(JSON.parse(String(init?.body)))
      return json([{ id: "new-lead" }])
    }
    if (url.includes("/rest/v1/leads")) {
      return json(opts.existingLead ? [opts.existingLead] : [])
    }
    if (url.includes("/rest/v1/icps")) {
      return json([{
        min_score: opts.minScore,
        target_roles: [],
        company_types: [],
        pain_points: [],
        raw_summary: null,
      }])
    }
    // Anything left is the LLM.
    return json({
      choices: [{
        message: {
          content: JSON.stringify({
            match_score: opts.llmScore ?? 0,
            match_reasons: ["r"],
            country: null,
          }),
        },
      }],
    })
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

Deno.test("below min_score: returns the score, inserts nothing, stored=false, inserted=false", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, llmScore: 42 })
  const res = await handler(makeReq({ device_token: "t", profile_data: { name: "A" } }))
  const body = await res.json()

  assertEquals(res.status, 200)
  assertEquals(body.match_score, 42)
  assertEquals(body.min_score, 70)
  assertEquals(body.stored, false)
  // A discarded lead was never written, so it can never count toward the cap.
  assertEquals(body.inserted, false)
  assertEquals(insertedRows.length, 0)
  restore()
})

Deno.test("at min_score: inserts and reports stored=true, inserted=true", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, llmScore: 70 })
  const res = await handler(makeReq({ device_token: "t", profile_data: { name: "A" } }))
  const body = await res.json()

  assertEquals(body.stored, true)
  // A fresh insert is the one path that counts toward the run's leadCount.
  assertEquals(body.inserted, true)
  // A score exactly at the threshold is kept (>=, not >), and the response
  // echoes both the score and the threshold it was measured against.
  assertEquals(body.match_score, 70)
  assertEquals(body.min_score, 70)
  assertEquals(insertedRows.length, 1)
  restore()
})

Deno.test("dedupe branch reports stored=true -- the row already exists", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, existingLead: { id: "l1", match_score: 90, match_reasons: ["r"] } })
  const res = await handler(makeReq({
    device_token: "t",
    profile_data: { name: "A", linkedin_url: "https://www.linkedin.com/in/a" },
  }))
  const body = await res.json()

  assertEquals(body.stored, true)
  assertEquals(body.match_score, 90)
  restore()
})

// The dedupe branch returns before the LLM and before any INSERT. `stored` is
// true (a row exists) but `inserted` is false (this call wrote nothing), so a
// re-encountered lead can never fill the run's NEW-work cap. The insert-count
// assertion is what proves the branch really skipped the write, not merely that
// it reported it did.
Deno.test("dedupe branch: stored=true, inserted=false, and nothing is written", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, existingLead: { id: "l1", match_score: 90, match_reasons: ["r"] } })
  const res = await handler(makeReq({
    device_token: "t",
    profile_data: { name: "A", linkedin_url: "https://www.linkedin.com/in/a" },
  }))
  const body = await res.json()

  assertEquals(body.stored, true)
  assertEquals(body.inserted, false)
  assertEquals(insertedRows.length, 0)
  restore()
})

Deno.test("folder_id belonging to the caller is written onto the lead", async () => {
  const restore = stubScoreLeadBackend({
    minScore: 70,
    llmScore: 90,
    folder: { id: "f1", user_id: "u1" },
  })
  const res = await handler(
    makeReq({ device_token: "t", profile_data: { name: "A" }, folder_id: "f1" })
  )
  assertEquals(res.status, 200)
  assertEquals((insertedRows[0] as Record<string, unknown>).folder_id, "f1")
  restore()
})

// A device_token is a bearer credential. An unvalidated folder id from one
// would let a leaked token write into another user's folder.
Deno.test("folder_id the caller does not own is rejected, and nothing is inserted", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, llmScore: 90, folder: null })
  const res = await handler(
    makeReq({ device_token: "t", profile_data: { name: "A" }, folder_id: "someone-elses" })
  )
  const body = await res.json()
  assertEquals(res.status, 400)
  assertEquals(body.error, "invalid_folder")
  assertEquals(insertedRows.length, 0)
  restore()
})

Deno.test("no folder_id inserts an unfiled lead, exactly as before", async () => {
  const restore = stubScoreLeadBackend({ minScore: 70, llmScore: 90 })
  await handler(makeReq({ device_token: "t", profile_data: { name: "A" } }))
  assertEquals((insertedRows[0] as Record<string, unknown>).folder_id, null)
  restore()
})

// A lead already filed somewhere must not be silently relocated by an
// unrelated search that happens to re-encounter it.
Deno.test("the dedupe branch does not move an existing lead into the run's folder", async () => {
  const restore = stubScoreLeadBackend({
    minScore: 70,
    existingLead: { id: "l1", match_score: 90, match_reasons: ["r"] },
    folder: { id: "f1", user_id: "u1" },
  })
  const res = await handler(
    makeReq({
      device_token: "t",
      profile_data: { name: "A", linkedin_url: "https://www.linkedin.com/in/a" },
      folder_id: "f1",
    })
  )
  const body = await res.json()
  assertEquals(body.stored, true)
  assertEquals(body.inserted, false)
  assertEquals(insertedRows.length, 0)
  restore()
})

// ---------------------------------------------------------------------------
// Batch path: `profiles` present. One LLM call for the whole page. `index` is
// load-bearing — a score must be matched back to its profile by the index the
// model echoes, never by array position, or a reordered/partial response would
// silently write a stranger's score onto a lead.
// ---------------------------------------------------------------------------

type BatchScoreItem = {
  index: number
  match_score: number
  match_reasons: string[]
  country: string | null
}

type ExistingLead = {
  id: string
  linkedin_url: string
  match_score: number
  match_reasons: string[]
}

let llmCallCount = 0
// The parsed body of the last LLM request, so tests can assert max_tokens scaled
// with the batch (an under-budgeted call truncates the JSON and fails the page).
let lastLlmBody: Record<string, unknown> | null = null

function stubBatchBackend(opts: {
  minScore: number
  scores?: BatchScoreItem[]
  existingLeads?: ExistingLead[]
  folder?: { id: string; user_id: string } | null
}): () => void {
  insertedRows = []
  llmCallCount = 0
  lastLlmBody = null
  Deno.env.set("SUPABASE_URL", "http://db.test")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "k")
  Deno.env.set("OPENROUTER_API_KEY", "k")

  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/rest/v1/extension_pairings")) {
      return json([{ user_id: "u1" }])
    }
    if (url.includes("/rest/v1/folders")) {
      return json(opts.folder ? [opts.folder] : [])
    }
    if (url.includes("/rest/v1/leads") && method === "POST") {
      const rows = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>
      for (const r of rows) insertedRows.push(r)
      // One id per row, in the order inserted, so lead_id matching is exercised.
      return json(rows.map((r, i) => ({ id: `new-${i}`, linkedin_url: r.linkedin_url })))
    }
    if (url.includes("/rest/v1/leads")) {
      // The single dedupe query: select ... where linkedin_url in (...).
      return json(opts.existingLeads ?? [])
    }
    if (url.includes("/rest/v1/icps")) {
      return json([{
        min_score: opts.minScore,
        target_roles: [],
        company_types: [],
        pain_points: [],
        raw_summary: null,
      }])
    }
    // Anything left is the LLM.
    llmCallCount++
    lastLlmBody = JSON.parse(String(init?.body))
    return json({
      choices: [{ message: { content: JSON.stringify({ scores: opts.scores ?? [] }) } }],
    })
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

const P = (n: string, url?: string): Record<string, unknown> =>
  url ? { name: n, linkedin_url: url } : { name: n }

Deno.test("batch of 3 with one dedupe hit: one LLM call, two inserted, the hit is not re-scored", async () => {
  const restore = stubBatchBackend({
    minScore: 70,
    existingLeads: [
      { id: "l-mid", linkedin_url: "https://li/b", match_score: 88, match_reasons: ["existing"] },
    ],
    scores: [
      { index: 0, match_score: 80, match_reasons: ["a"], country: "US" },
      { index: 1, match_score: 75, match_reasons: ["c"], country: null },
    ],
  })
  const res = await handler(makeReq({
    device_token: "t",
    profiles: [
      P("A", "https://li/a"),
      P("B", "https://li/b"), // dedupe hit
      P("C", "https://li/c"),
    ],
  }))
  const body = await res.json()

  assertEquals(res.status, 200)
  // One LLM call for the whole page — the point of the task.
  assertEquals(llmCallCount, 1)
  // Two rows inserted; the dedupe hit was not re-inserted.
  assertEquals(insertedRows.length, 2)
  // Results are in input order and echo each linkedin_url.
  assertEquals(body.results.length, 3)
  assertEquals(body.results.map((r: { linkedin_url: string }) => r.linkedin_url), [
    "https://li/a",
    "https://li/b",
    "https://li/c",
  ])
  // A and C were scored and inserted.
  assertEquals(body.results[0].inserted, true)
  assertEquals(body.results[0].match_score, 80)
  assertEquals(body.results[2].inserted, true)
  assertEquals(body.results[2].match_score, 75)
  // The middle one is the dedupe hit: stored, not inserted, its old score kept
  // (the LLM never scored it, so it cannot have been re-scored).
  assertEquals(body.results[1].stored, true)
  assertEquals(body.results[1].inserted, false)
  assertEquals(body.results[1].match_score, 88)
  assertEquals(body.results[1].lead_id, "l-mid")
  // maxTokens scaled with the batch: 256 + 160 * 3.
  assertEquals(lastLlmBody?.max_tokens, 256 + 160 * 3)
  restore()
})

Deno.test("batch below min_score: stored=false but match_score and match_reasons still present", async () => {
  const restore = stubBatchBackend({
    minScore: 70,
    scores: [{ index: 0, match_score: 42, match_reasons: ["weak"], country: null }],
  })
  const res = await handler(makeReq({
    device_token: "t",
    profiles: [P("A", "https://li/a")],
  }))
  const body = await res.json()

  assertEquals(body.results.length, 1)
  assertEquals(body.results[0].stored, false)
  assertEquals(body.results[0].inserted, false)
  // The muted badge is drawn from these — a missing badge must mean "not scored".
  assertEquals(body.results[0].match_score, 42)
  assertEquals(body.results[0].match_reasons, ["weak"])
  assertEquals(insertedRows.length, 0)
  restore()
})

Deno.test("batch with reordered scores: each score lands on the right profile by index, not position", async () => {
  const restore = stubBatchBackend({
    minScore: 50,
    // Model returns the two scores in reverse order.
    scores: [
      { index: 1, match_score: 90, match_reasons: ["strong"], country: null },
      { index: 0, match_score: 30, match_reasons: ["weak"], country: null },
    ],
  })
  const res = await handler(makeReq({
    device_token: "t",
    profiles: [P("A", "https://li/a"), P("B", "https://li/b")],
  }))
  const body = await res.json()

  // If matched by position, A would wrongly get 90. Matched by index, A gets 30.
  assertEquals(body.results[0].linkedin_url, "https://li/a")
  assertEquals(body.results[0].match_score, 30)
  assertEquals(body.results[1].linkedin_url, "https://li/b")
  assertEquals(body.results[1].match_score, 90)
  restore()
})

Deno.test("batch with a missing index: that profile is absent from results, the others unaffected", async () => {
  const restore = stubBatchBackend({
    minScore: 70,
    // Only profile 0 is scored; profile 1's index is omitted entirely.
    scores: [{ index: 0, match_score: 80, match_reasons: ["ok"], country: null }],
  })
  const res = await handler(makeReq({
    device_token: "t",
    profiles: [P("A", "https://li/a"), P("B", "https://li/b")],
  }))
  const body = await res.json()

  // The omitted profile drops out; the scored one is unaffected and inserted.
  assertEquals(body.results.length, 1)
  assertEquals(body.results[0].linkedin_url, "https://li/a")
  assertEquals(body.results[0].inserted, true)
  assertEquals(insertedRows.length, 1)
  restore()
})

Deno.test("batch folder_id the caller does not own is rejected, nothing inserted", async () => {
  const restore = stubBatchBackend({
    minScore: 70,
    folder: null,
    scores: [{ index: 0, match_score: 90, match_reasons: ["ok"], country: null }],
  })
  const res = await handler(makeReq({
    device_token: "t",
    folder_id: "someone-elses",
    profiles: [P("A", "https://li/a")],
  }))
  const body = await res.json()

  assertEquals(res.status, 400)
  assertEquals(body.error, "invalid_folder")
  assertEquals(insertedRows.length, 0)
  // Rejected before the LLM was ever called.
  assertEquals(llmCallCount, 0)
  restore()
})

Deno.test("batch dedupe hit is not relocated into the run's folder", async () => {
  const restore = stubBatchBackend({
    minScore: 70,
    folder: { id: "f1", user_id: "u1" },
    existingLeads: [
      { id: "l1", linkedin_url: "https://li/a", match_score: 90, match_reasons: ["r"] },
    ],
    scores: [],
  })
  const res = await handler(makeReq({
    device_token: "t",
    folder_id: "f1",
    profiles: [P("A", "https://li/a")],
  }))
  const body = await res.json()

  assertEquals(body.results.length, 1)
  assertEquals(body.results[0].stored, true)
  assertEquals(body.results[0].inserted, false)
  // Nothing written, so the existing lead keeps whatever folder it already had.
  assertEquals(insertedRows.length, 0)
  restore()
})

Deno.test("batch over MAX_BATCH is rejected with batch_too_large", async () => {
  const restore = stubBatchBackend({ minScore: 70 })
  const profiles = Array.from({ length: 21 }, (_, i) => P(`p${i}`, `https://li/${i}`))
  const res = await handler(makeReq({ device_token: "t", profiles }))
  const body = await res.json()

  assertEquals(res.status, 400)
  assertEquals(body.error, "batch_too_large")
  assertEquals(llmCallCount, 0)
  restore()
})

Deno.test("empty profiles array is rejected with missing_fields", async () => {
  const restore = stubBatchBackend({ minScore: 70 })
  const res = await handler(makeReq({ device_token: "t", profiles: [] }))
  const body = await res.json()

  assertEquals(res.status, 400)
  assertEquals(body.error, "missing_fields")
  restore()
})
