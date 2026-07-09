import { useEffect, useState, type FormEvent } from "react"
import { browser } from "wxt/browser"
import { clearDeviceToken, getDeviceToken, pair } from "@/lib/pairing"
import { getRunState, type RunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [code, setCode] = useState("")
  const [pairError, setPairError] = useState(false)
  const [busy, setBusy] = useState(false)

  const [query, setQuery] = useState("")
  const [running, setRunning] = useState(false)
  const [leadCount, setLeadCount] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  // The popup is destroyed on every blur and rebuilt from nothing on every
  // open, so it can hold no run state of its own — glint_run is the only thing
  // that survives, and every mount must rehydrate from it. Getting this wrong
  // is not cosmetic: a popup that thinks nothing is running will offer Start,
  // and Start on top of a live run is what handleStartRunMessage() has to
  // reject in the background.
  useEffect(() => {
    Promise.all([getDeviceToken(), getRunState()]).then(([token, run]) => {
      if (run?.active) {
        setRunning(true)
        setQuery(run.query)
        setLeadCount(run.leadCount)
        setStatus("Run in progress…")
      }
      setPaired(token !== null)
    })
  }, [])

  // Two independent sources, because neither covers the other. Runtime messages
  // carry the status line but only while the popup happens to be open; glint_run
  // carries the authoritative lead count and survives the popup being closed.
  useEffect(() => {
    function onMessage(message: RuntimeMessage) {
      if (message.type === "PROGRESS") {
        setLeadCount(message.leadCount)
        setStatus(message.status)
      } else if (message.type === "STOPPED") {
        setRunning(false)
        setStatus(message.reason)
      } else if (message.type === "RUN_ERROR") {
        setRunning(false)
        setRunError(message.error)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)

    function onStorage(
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) {
      if (area !== "local" || !changes.glint_run) return
      const next = changes.glint_run.newValue as RunState | undefined
      setRunning(!!next?.active)
      if (next?.active) setLeadCount(next.leadCount)
    }
    browser.storage.onChanged.addListener(onStorage)

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      browser.storage.onChanged.removeListener(onStorage)
    }
  }, [])

  async function handlePair(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setPairError(false)
    try {
      await pair(code.trim())
      setPaired(true)
      setCode("")
    } catch {
      setPairError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleUnpair() {
    await clearDeviceToken()
    setPaired(false)
  }

  function handleStart(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setRunError(null)
    setStatus(null)
    setLeadCount(0)
    setRunning(true)
    chrome.runtime.sendMessage({ type: "START_RUN", query: trimmed } satisfies RuntimeMessage)
  }

  function handleStop() {
    chrome.runtime.sendMessage({ type: "STOP_RUN" } satisfies RuntimeMessage)
    setRunning(false)
  }

  if (paired === null) {
    return <div className="bg-background text-foreground w-96 p-4 text-sm">Loading…</div>
  }

  return (
    // Chrome hard-caps a popup at 800x600 and gives no warning when content
    // overflows — it just clips. 560px leaves room for the browser chrome.
    <div className="bg-background text-foreground flex max-h-[560px] w-96 flex-col gap-3 overflow-y-auto p-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-base font-semibold">Glint</h1>
        <p className="text-muted-foreground text-xs">
          Find and score LinkedIn leads against your ICP
        </p>
      </header>

      {!paired ? (
        <form onSubmit={handlePair} className="flex flex-col gap-2">
          <label className="text-sm">Paste your pairing code from Glint → Settings.</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXXXX"
            className="border-border bg-card focus-visible:ring-ring rounded-md border px-3 py-1.5 font-mono tracking-widest uppercase outline-none focus-visible:ring-2"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
          {pairError && (
            <p className="text-destructive text-sm">
              Invalid or expired code. Generate a new one.
            </p>
          )}
        </form>
      ) : (
        <>
          <form onSubmit={handleStart} className="flex flex-col gap-2">
            <label className="text-sm font-medium">Who are you looking for?</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me CEOs of ecommerce startups"
              className="border-border bg-card focus-visible:ring-ring min-h-20 resize-none rounded-[var(--radius)] border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
              required
              disabled={running}
            />
            {!running ? (
              <button
                type="submit"
                disabled={query.trim().length === 0}
                className="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors"
              >
                Stop
              </button>
            )}
          </form>

          {runError && <p className="text-destructive text-sm">{runError}</p>}

          {running && (
            <div className="border-border bg-card flex flex-col gap-1 rounded-[var(--radius)] border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold tabular-nums">{leadCount}</span>
                <span className="text-primary flex items-center gap-1.5 text-xs font-medium">
                  <span className="bg-primary h-1.5 w-1.5 animate-pulse rounded-full" />
                  Running
                </span>
              </div>
              <p className="text-muted-foreground text-xs">Leads found</p>
              {status && (
                <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-xs">
                  {status}
                </p>
              )}
              {/* The run keeps going once this popup closes — the toolbar badge
                  and the on-page overlay are where it stays visible. */}
              <p className="text-muted-foreground mt-1 text-xs">
                Keeps running when you close this popup.
              </p>
            </div>
          )}

          <button
            onClick={handleUnpair}
            className="border-border bg-card hover:bg-accent mt-auto self-start rounded-md border px-3 py-1.5 text-xs transition-colors"
          >
            Unpair
          </button>
        </>
      )}
    </div>
  )
}
