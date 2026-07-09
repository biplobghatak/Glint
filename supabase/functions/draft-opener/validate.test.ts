import { assertEquals } from "jsr:@std/assert@1"
import { MAX_OPENER_CHARS, validateOpener } from "./validate.ts"

// Every valid opener now begins with a greeting, so the fixtures do too. The
// greeting is checked after the dash and length rules, which is why the tests
// for those can still assert their own reason while carrying one.
const HI = "Hi Priya, "

Deno.test("accepts a short opener ending in a question", () => {
  assertEquals(validateOpener(`${HI}saw your work on payments. Open to a quick chat?`).ok, true)
})

Deno.test("accepts an imperative call to action", () => {
  assertEquals(
    validateOpener(`${HI}saw your work on payments. Let me know if you're open to a chat.`).ok,
    true
  )
})

Deno.test("accepts Hello and Hey", () => {
  assertEquals(validateOpener("Hello Priya, open to a chat?").ok, true)
  assertEquals(validateOpener("Hey Priya, open to a chat?").ok, true)
})

Deno.test("accepts the nameless greeting", () => {
  assertEquals(validateOpener("Hi there, open to a chat?").ok, true)
})

Deno.test("rejects an opener with no greeting", () => {
  const r = validateOpener("Saw your work on payments. Open to a quick chat?")
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "no_greeting")
})

// "History" starts with "Hi". \b in the GREETING pattern is what stops it.
Deno.test("does not mistake a word starting with hi for a greeting", () => {
  const r = validateOpener("History suggests you'd be interested. Open to a chat?")
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "no_greeting")
})

Deno.test("rejects a placeholder token the sender would have to fill in", () => {
  for (const bad of ["Hi [Name], open to a chat?", "Hi {{first_name}}, open to a chat?", "Hi <first name>, open to a chat?"]) {
    const r = validateOpener(bad)
    assertEquals(r.ok, false)
    assertEquals(r.ok === false && r.reason, "placeholder")
  }
})

Deno.test("rejects an em dash", () => {
  const r = validateOpener(`${HI}saw your work — impressive. Open to a chat?`)
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "dash")
})

Deno.test("rejects an en dash", () => {
  assertEquals(validateOpener(`${HI}saw your work – nice. Open to a chat?`).ok, false)
})

Deno.test("rejects over the character limit", () => {
  const long = HI + "a".repeat(MAX_OPENER_CHARS - HI.length) + " ok?"
  const r = validateOpener(long)
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "too_long")
})

Deno.test("accepts exactly the character limit", () => {
  const exact = HI + "a".repeat(MAX_OPENER_CHARS - HI.length - 1) + "?"
  assertEquals(exact.length, MAX_OPENER_CHARS)
  assertEquals(validateOpener(exact).ok, true)
})

Deno.test("rejects a flat statement with no call to action", () => {
  const r = validateOpener(`${HI}I saw your work on payments and thought it was impressive.`)
  assertEquals(r.ok, false)
  assertEquals(r.ok === false && r.reason, "no_cta")
})

Deno.test("rejects an empty opener", () => {
  assertEquals(validateOpener("   ").ok, false)
})
