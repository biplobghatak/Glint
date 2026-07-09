import { browser } from "wxt/browser"

// A device_token resolves, server-side, to exactly one SITE. Holding several
// lets one browser scan for several websites without re-pairing, and the active
// token is the only thing that decides where a lead lands — no request ever
// carries a site id, so a stale panel cannot file leads into the wrong website.
const PAIRINGS_KEY = "glint_pairings"
const ACTIVE_KEY = "glint_active_site"

// Pre-multi-site installs stored a single token here and nothing else. It still
// works — the server resolves it to the site the migration backfilled — but the
// extension does not yet know that site's id or name. adoptLegacyPairing() moves
// it into the map once list-leads reports which site it is.
const LEGACY_TOKEN_KEY = "glint_device_token"

export type Pairing = {
  siteId: string
  siteName: string
  token: string
}

type PairingMap = Record<string, { token: string; siteName: string }>

const env = import.meta.env as unknown as Record<string, string>

async function readMap(): Promise<PairingMap> {
  const res = await browser.storage.local.get(PAIRINGS_KEY)
  return (res[PAIRINGS_KEY] as PairingMap) ?? {}
}

async function writeMap(map: PairingMap): Promise<void> {
  await browser.storage.local.set({ [PAIRINGS_KEY]: map })
}

async function getLegacyToken(): Promise<string | null> {
  const res = await browser.storage.local.get(LEGACY_TOKEN_KEY)
  return (res[LEGACY_TOKEN_KEY] as string) ?? null
}

export async function getActiveSiteId(): Promise<string | null> {
  const res = await browser.storage.local.get(ACTIVE_KEY)
  return (res[ACTIVE_KEY] as string) ?? null
}

export async function setActiveSite(siteId: string): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: siteId })
}

export async function listPairings(): Promise<Pairing[]> {
  const map = await readMap()
  return Object.entries(map)
    .map(([siteId, v]) => ({ siteId, siteName: v.siteName, token: v.token }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName))
}

/**
 * The token every request should carry. Resolves the active site, falling back
 * to the only pairing, then to a not-yet-adopted legacy token. Callers stay
 * unchanged: they ask for "the" token and get the active one.
 */
export async function getDeviceToken(): Promise<string | null> {
  const map = await readMap()
  const ids = Object.keys(map)

  if (ids.length > 0) {
    const active = await getActiveSiteId()
    const chosen = active && map[active] ? active : ids[0]
    return map[chosen].token
  }

  return await getLegacyToken()
}

/** The token for one specific site. A run pins this so switching mid-run cannot
 * retarget the leads it is still writing. */
export async function getTokenForSite(
  siteId: string | null
): Promise<string | null> {
  if (!siteId) return await getDeviceToken()
  const map = await readMap()
  return map[siteId]?.token ?? (await getDeviceToken())
}

export async function setPairing(p: Pairing): Promise<void> {
  const map = await readMap()
  map[p.siteId] = { token: p.token, siteName: p.siteName }
  await writeMap(map)
  await setActiveSite(p.siteId)
}

/**
 * Re-key the pre-multi-site token under the site the server says it belongs to.
 * Idempotent: once the map holds an entry, the legacy key is gone.
 */
export async function adoptLegacyPairing(
  siteId: string,
  siteName: string
): Promise<void> {
  const token = await getLegacyToken()
  if (!token) return

  const map = await readMap()
  if (!map[siteId]) {
    map[siteId] = { token, siteName }
    await writeMap(map)
  }
  if (!(await getActiveSiteId())) {
    await setActiveSite(siteId)
  }
  await browser.storage.local.remove(LEGACY_TOKEN_KEY)
}

/** Unpair one site. Unpairing the active one promotes whatever remains. */
export async function clearPairing(siteId: string): Promise<void> {
  const map = await readMap()
  delete map[siteId]
  await writeMap(map)

  if ((await getActiveSiteId()) === siteId) {
    const remaining = Object.keys(map)
    if (remaining.length > 0) {
      await setActiveSite(remaining[0])
    } else {
      await browser.storage.local.remove(ACTIVE_KEY)
    }
  }
}

/** Unpair everything, including a legacy token. */
export async function clearDeviceToken(): Promise<void> {
  await browser.storage.local.remove([PAIRINGS_KEY, ACTIVE_KEY, LEGACY_TOKEN_KEY])
}

export async function pair(code: string): Promise<Pairing> {
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

  const { device_token, site } = (await res.json()) as {
    device_token: string
    site: { id: string; name: string } | null
  }

  // A server that answered without a site is one this build cannot key a map
  // by. Refuse rather than silently stranding the token under a made-up id.
  if (!site?.id) throw new Error("invalid_code")

  const pairing: Pairing = {
    siteId: site.id,
    siteName: site.name,
    token: device_token,
  }
  await setPairing(pairing)
  return pairing
}
