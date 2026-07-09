import { assertEquals } from "jsr:@std/assert@1"
import { MAX_OPENER_CHARS, validateOpener } from "./validate.ts"

Deno.test("accepts a short opener ending in a question", () => {
  assertEquals(validateOpener("Saw your work on payments. Open to a quick chat?").ok, true)
})

Deno.test("accepts an imperative call to action", () => {
  assertEquals(validateOpener("Saw your work on payments. Let me know if you're open to a chat.").ok, true)
})

Deno.test("rejects an em dash", () => {
  const r = validateOpener("Saw your work — impressive. Open to a chat?")
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "dash")
})

Deno.test("rejects an en dash", () => {
  assertEquals(validateOpener("Saw your work – nice. Open to a chat?").ok, false)
})

Deno.test("rejects over the character limit", () => {
  const long = "a".repeat(MAX_OPENER_CHARS - 1) + " ok?"
  assertEquals(validateOpener(long).ok, false)
})

Deno.test("accepts exactly the character limit", () => {
  const exact = "a".repeat(MAX_OPENER_CHARS - 1) + "?"
  assertEquals(exact.length, MAX_OPENER_CHARS)
  assertEquals(validateOpener(exact).ok, true)
})

Deno.test("rejects a flat statement with no call to action", () => {
  const r = validateOpener("I saw your work on payments and thought it was impressive.")
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "no_cta")
})

Deno.test("rejects an empty opener", () => {
  assertEquals(validateOpener("   ").ok, false)
})
