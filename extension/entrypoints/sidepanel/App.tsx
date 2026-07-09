import { useEffect, useState, type FormEvent } from "react"
import { getDeviceToken } from "@/lib/pairing"
import { getRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [query, setQuery] = useState("")
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [leadCount, setLeadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The side panel document is unloaded/remounted whenever Chrome disables
    // it for the active tab (e.g. the user switches to a non-LinkedIn tab
    // and back), so on every mount we must rehydrate from glint_run — not
    // just re-check pairing — or an in-flight run becomes invisible/
    // unstoppable and Start would fire a second, overlapping run.
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
        setError(message.error)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  function handleStart(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setError(null)
    setStatus(null)
    setLeadCount(0)
    setRunning(true)
    chrome.runtime.sendMessage({ type: "START_RUN", query: trimmed })
  }

  function handleStop() {
    chrome.runtime.sendMessage({ type: "STOP_RUN" })
    setRunning(false)
  }

  if (paired === null) {
    return <div className="p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {!paired ? (
        <>
          <p className="text-muted-foreground text-sm">
            Open the Glint extension icon popup to pair with your account first.
          </p>
          {running && (
            <button
              type="button"
              onClick={handleStop}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Stop
            </button>
          )}
        </>
      ) : (
        <>
          <form onSubmit={handleStart} className="flex flex-col gap-2">
            <label className="text-sm">Who are you looking for?</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me CEOs of ecommerce startups"
              className="min-h-20 rounded-md border px-3 py-1.5 text-sm"
              required
              disabled={running}
            />
            {!running ? (
              <button
                type="submit"
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={query.trim().length === 0}
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                Stop
              </button>
            )}
          </form>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {(running || status) && (
            <div className="rounded-md border p-3 text-sm">
              <p>Leads found: {leadCount}</p>
              {status && <p className="text-muted-foreground">{status}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
