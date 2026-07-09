import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1"
import { handler } from "./handler.ts"

// enriched_at is the load-bearing column here: it is what lets the panel tell
// "we looked at this profile and it publishes no contact info" apart from "we
// have never looked". Every test below that reaches the UPDATE asserts it is
// set, not just that the call succeeded.

type Pairing = { user_id: string } | null

let patchCalls: { url: string; body: Record<string, unknown> }[] = []
let leadsTouched = false

function makeReq(body: unknown): Request {
  return new Request("http://localhost/enrich-lead", {
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

function stubEnrichLeadBackend(opts: {
  pairing: Pairing
  // The row PostgREST would return for the UPDATE's `.eq("id", ...).eq("user_id", ...)`
  // predicate. null models "no row matched" -- a missing lead OR one owned by
  // someone else are indistinguishable at this layer, which is the point.
  matchedLead: { id: string } | null
}): () => void {
  patchCalls = []
  leadsTouched = false
  Deno.env.set("SUPABASE_URL", "http://db.test")
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "k")

  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.includes("/rest/v1/extension_pairings")) {
      return json(opts.pairing ? [opts.pairing] : [])
    }
    if (url.includes("/rest/v1/leads")) {
      leadsTouched = true
      if (method === "PATCH") {
        patchCalls.push({ url, body: JSON.parse(String(init?.body)) })
        return json(opts.matchedLead ? [opts.matchedLead] : [])
      }
    }
    throw new Error(`unexpected fetch in enrich-lead test: ${method} ${url}`)
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

Deno.test("sets enriched_at even when email and phone are both null", async () => {
  const restore = stubEnrichLeadBackend({
    pairing: { user_id: "u1" },
    matchedLead: { id: "l1" },
  })
  const res = await handler(makeReq({ device_token: "t", lead_id: "l1" }))
  const body = await res.json()

  assertEquals(res.status, 200)
  assertEquals(body.ok, true)
  assertEquals(patchCalls.length, 1)
  const written = patchCalls[0].body
  // enriched_at is unconditional: neither email nor phone (nor avatar_url) was
  // in the request body, yet the timestamp is still written.
  assertEquals(typeof written.enriched_at, "string")
  assertEquals("email" in written, false)
  assertEquals("phone" in written, false)
  assertEquals("avatar_url" in written, false)
  restore()
})

Deno.test("writes email and phone when present", async () => {
  const restore = stubEnrichLeadBackend({
    pairing: { user_id: "u1" },
    matchedLead: { id: "l1" },
  })
  const res = await handler(
    makeReq({
      device_token: "t",
      lead_id: "l1",
      avatar_url: "https://media.licdn.com/img.jpg",
      email: "a@example.com",
      phone: "+1-555-0100",
    })
  )
  const body = await res.json()

  assertEquals(res.status, 200)
  assertEquals(body.ok, true)
  const written = patchCalls[0].body
  assertEquals(written.avatar_url, "https://media.licdn.com/img.jpg")
  assertEquals(written.email, "a@example.com")
  assertEquals(written.phone, "+1-555-0100")
  assertEquals(typeof written.enriched_at, "string")
  restore()
})

Deno.test("a lead_id belonging to another user is rejected and nothing is written", async () => {
  const restore = stubEnrichLeadBackend({
    pairing: { user_id: "u1" },
    // The service-role UPDATE is scoped .eq("id", lead_id).eq("user_id", "u1").
    // A lead owned by someone else matches zero rows under that predicate --
    // modelled here by an empty result, exactly as PostgREST would return.
    matchedLead: null,
  })
  const res = await handler(
    makeReq({ device_token: "t", lead_id: "someone-elses-lead", email: "a@example.com" })
  )
  const body = await res.json()

  assertEquals(res.status, 404)
  assertEquals(body.error, "not_found")
  // Confirm the ownership filter was actually sent on the wire, not merely
  // that the mocked response happened to be empty -- this is the one barrier
  // stopping a leaked device_token from writing onto a stranger's lead.
  assertEquals(patchCalls.length, 1)
  assertStringIncludes(patchCalls[0].url, "id=eq.someone-elses-lead")
  assertStringIncludes(patchCalls[0].url, "user_id=eq.u1")
  restore()
})

Deno.test("an unknown device_token returns 401 and never touches the database", async () => {
  const restore = stubEnrichLeadBackend({ pairing: null, matchedLead: null })
  const res = await handler(makeReq({ device_token: "bad-token", lead_id: "l1" }))
  const body = await res.json()

  assertEquals(res.status, 401)
  assertEquals(body.error, "unpaired")
  assertEquals(leadsTouched, false)
  restore()
})
