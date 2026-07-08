const OPENAI_BASE_URL =
  Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1"
const DEFAULT_MODEL = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini"

export type JsonSchema = Record<string, unknown>

export async function callLLMJson<T>(opts: {
  messages: { role: string; content: string }[]
  schema: JsonSchema
  schemaName: string
  maxTokens?: number
  model?: string
}): Promise<T> {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      messages: opts.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: opts.schemaName,
          strict: true,
          schema: opts.schema,
        },
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${JSON.stringify(data)}`)
  }

  const content = data.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new Error(`LLM returned no content: ${JSON.stringify(data)}`)
  }

  return JSON.parse(content) as T
}
