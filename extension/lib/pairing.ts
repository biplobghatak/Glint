import { browser } from "wxt/browser"

const TOKEN_KEY = "glint_device_token"

const env = import.meta.env as unknown as Record<string, string>

export async function getDeviceToken(): Promise<string | null> {
  const res = await browser.storage.local.get(TOKEN_KEY)
  return (res[TOKEN_KEY] as string) ?? null
}

export async function setDeviceToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token })
}

export async function clearDeviceToken(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY)
}

export async function pair(code: string): Promise<void> {
  const url = `${env.WXT_SUPABASE_URL}/functions/v1/pair-extension`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.WXT_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ pairing_code: code }),
  })
  if (!res.ok) throw new Error("invalid_code")
  const { device_token } = (await res.json()) as { device_token: string }
  await setDeviceToken(device_token)
}
