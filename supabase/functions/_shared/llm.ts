const OPENROUTER_BASE_URL =
  Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1"
const DEFAULT_MODEL =
  Deno.env.get("LLM_MODEL") ?? "deepseek/deepseek-v4-flash"

export type JsonSchema = Record<string, unknown>

export async function callLLMJson<T>(opts: {
  messages: { role: string; content: string }[]
  schema: JsonSchema
  schemaName: string
  maxTokens?: number
  model?: string
  reasoning?: boolean
}): Promise<T> {
  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      messages: opts.messages,
      // Reasoning models spend max_tokens on chain-of-thought before emitting
      // content, which truncates the JSON and leaks deliberation into fields.
      reasoning: { enabled: opts.reasoning ?? false },
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
