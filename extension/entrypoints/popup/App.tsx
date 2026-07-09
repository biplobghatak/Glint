import { useEffect, useState, type FormEvent } from "react"
import {
  clearPairing,
  getDeviceToken,
  listPairings,
  pair,
  type Pairing,
} from "@/lib/pairing"
import { isLinkedIn } from "@/lib/linkedin"

type ActiveTab = { id: number | undefined; url: string | undefined }

export default function App() {
  const [pairings, setPairings] = useState<Pairing[] | null>(null)
  // A token stored before multi-site: it works, but its site is unknown until
  // the side panel calls list-leads and adopts it. Shown as "paired" so this
  // screen never tells a working install that it is not.
  const [hasLegacy, setHasLegacy] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null)

  async function refresh() {
    const list = await listPairings()
    setPairings(list)
    setHasLegacy(list.length === 0 && (await getDeviceToken()) !== null)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (import.meta.env.BROWSER !== "chrome") return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      setActiveTab(tab ? { id: tab.id, url: tab.url } : null)
    })
  }, [])

  function handleOpenPanel() {
    if (activeTab?.id === undefined) return
    // Call chrome.sidePanel.open() synchronously as the first async
    // operation of the click handler — awaiting anything before it would
    // consume the user gesture it requires. Close only once it resolves;
    // tearing down the popup while the call is pending can abort it.
    chrome.sidePanel
      .open({ tabId: activeTab.id })
      .then(() => window.close())
      .catch((err) => console.debug("Glint: sidePanel.open failed", err))
  }

  async function handlePair(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(false)
    try {
      await pair(code.trim())
      await refresh()
      setCode("")
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleUnpair(siteId: string) {
    await clearPairing(siteId)
    await refresh()
  }

  if (pairings === null) {
    return (
      <div className="bg-background text-foreground w-72 p-4 text-sm">Loading…</div>
    )
  }

  return (
    <div className="bg-background text-foreground flex w-72 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {import.meta.env.BROWSER === "chrome" &&
        activeTab?.id !== undefined &&
        isLinkedIn(activeTab.url) && (
          <button
            onClick={handleOpenPanel}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Open Glint panel
          </button>
        )}
      {hasLegacy && <p className="text-sm text-green-600">Extension paired ✓</p>}

      {pairings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pairings.map((p) => (
            <li
              key={p.siteId}
              className="border-border bg-card flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
            >
              <span className="truncate text-sm">{p.siteName}</span>
              <button
                onClick={() => handleUnpair(p.siteId)}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Unpair
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pairing stays available: a second code adds a second website rather
          than replacing the first. */}
      {(
        <form onSubmit={handlePair} className="flex flex-col gap-2">
          <label className="text-sm">
            {pairings.length > 0 || hasLegacy
              ? "Pair another website with a new code."
              : "Paste your pairing code from Glint → Settings."}
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXXXX"
            className="border-border bg-card rounded-md border px-3 py-1.5 font-mono tracking-widest uppercase focus-visible:ring-2 focus-visible:ring-ring outline-none"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
          {error && (
            <p className="text-destructive text-sm">
              Invalid or expired code. Generate a new one.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
