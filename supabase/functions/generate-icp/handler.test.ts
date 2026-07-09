import { assert, assertEquals } from "jsr:@std/assert@1"
import { handler, normalizeCountries } from "./handler.ts"

function makeReq(body: unknown): Request {
  return new Request("http://localhost/generate-icp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Replace globalThis.fetch; returns a restore function.
function stubFetch(
  fake: (url: string, init?: RequestInit) => Promise<Response>,
): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    fake(String(input), init)) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

function setEnv() {
  Deno.env.set("CRAWL_SERVICE_URL", "http://crawl.test")
  Deno.env.set("CRAWL_SERVICE_SECRET", "s")
}

const LONG_CONTENT = "Acme helps revenue teams. ".repeat(30) // > 200 chars

Deno.test("sufficient scraped content -> returns ICP", async () => {
  setEnv()
  let mdInit: RequestInit | undefined
  const restore = stubFetch(async (url, init) => {
    if (url.endsWith("/md")) {
      mdInit = init
      return new Response(
        JSON.stringify({ success: true, markdown: LONG_CONTENT }),
        { status: 200 },
      )
    }
    // LLM call (OpenAI /chat/completions)
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              target_roles: ["VP Sales"],
              company_types: ["B2B SaaS"],
              pain_points: ["forecasting"],
              raw_summary: "ok",
              target_countries: ["US", "GB"],
            }),
          },
        }],
      }),
      { status: 200 },
    )
  })
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    const data = await res.json()
    assertEquals(res.status, 200)
    assert(!("needs_manual_input" in data))
    assertEquals(data.target_roles, ["VP Sales"])
    assertEquals(data.target_countries, ["US", "GB"])
    // The /md call carries the bearer token and JSON content type.
    const headers = mdInit?.headers as Record<string, string>
    assertEquals(headers["Authorization"], "Bearer s")
    assertEquals(headers["Content-Type"], "application/json")
  } finally {
    restore()
  }
})

Deno.test("model's country codes are normalized before they reach the client", async () => {
  setEnv()
  const restore = stubFetch(async (url) => {
    if (url.endsWith("/md")) {
      return new Response(
        JSON.stringify({ success: true, markdown: LONG_CONTENT }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              target_roles: [],
              company_types: [],
              pain_points: [],
              raw_summary: "ok",
              // The schema only pins the type, so the model can emit lowercase,
              // three-letter codes, prose, and duplicates. All must be dropped
              // or folded: a bad code is a filter that matches nothing.
              target_countries: ["us", "USA", "United Kingdom", "gb", "GB", ""],
            }),
          },
        }],
      }),
      { status: 200 },
    )
  })
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    const data = await res.json()
    assertEquals(data.target_countries, ["US", "GB"])
  } finally {
    restore()
  }
})

Deno.test("normalizeCountries drops non-alpha-2 values and non-arrays", () => {
  assertEquals(normalizeCountries(["de", " fr "]), ["DE", "FR"])
  assertEquals(normalizeCountries(["USA", "Germany", "1", "", "x"]), [])
  // An absent target_countries must read as "sells everywhere", not as a crash.
  assertEquals(normalizeCountries(undefined), [])
  assertEquals(normalizeCountries(null), [])
  assertEquals(normalizeCountries("US"), [])
})

Deno.test("too-short scraped content -> needs_manual_input", async () => {
  setEnv()
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ success: true, markdown: "short" }), { status: 200 }))
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    assertEquals(await res.json(), { needs_manual_input: true })
  } finally {
    restore()
  }
})

Deno.test("crawl4ai service failure -> needs_manual_input", async () => {
  setEnv()
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ error: "boom" }), { status: 502 }))
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    assertEquals(await res.json(), { needs_manual_input: true })
  } finally {
    restore()
  }
})

Deno.test("crawl4ai service throws (timeout/network) -> needs_manual_input", async () => {
  setEnv()
  const restore = stubFetch(() => Promise.reject(new Error("timeout")))
  try {
    const res = await handler(makeReq({ website_url: "https://example.com" }))
    assertEquals(await res.json(), { needs_manual_input: true })
  } finally {
    restore()
  }
})
