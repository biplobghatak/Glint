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
