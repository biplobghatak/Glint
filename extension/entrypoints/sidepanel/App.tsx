import { useEffect, useState, type FormEvent } from "react"
import { getDeviceToken } from "@/lib/pairing"
import { getRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [query, setQuery] = useState("")
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [leadCount, setLeadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Spec §5 asks the panel to show elapsed time against the run's cap, and §6
  // asks the accuracy caveat to stay visible. Neither shipped originally.
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [maxMinutes, setMaxMinutes] = useState(20)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running, startedAt])

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
        // Rehydrating the true start time matters: the panel is remounted every
        // time Chrome disables it for a non-LinkedIn tab and re-enables it, and
        // an elapsed timer that restarted from zero on each remount would tell
        // the user the run is younger than it is, right up until the cap fires.
        setStartedAt(run.startedAt)
        setMaxMinutes(run.maxMinutes)
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
        setStartedAt(null)
        setStatus(message.reason)
      } else if (message.type === "RUN_ERROR") {
        setRunning(false)
        setStartedAt(null)
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
    // Optimistic: the authoritative startedAt is written by the background when
    // it persists glint_run. This is within a few ms of it, and the panel
    // rehydrates the real value on its next mount.
    setStartedAt(Date.now())
    setNow(Date.now())
    chrome.runtime.sendMessage({ type: "START_RUN", query: trimmed })
  }

  function handleStop() {
    chrome.runtime.sendMessage({ type: "STOP_RUN" })
    setRunning(false)
    setStartedAt(null)
  }

  if (paired === null) {
    return (
      <div className="bg-background text-foreground flex h-full items-center justify-center p-4 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="bg-background text-foreground flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-base font-semibold">Glint</h1>
        <p className="text-muted-foreground text-xs">
          Find and score LinkedIn leads against your ICP
        </p>
      </header>
      {!paired ? (
        <>
          <p className="text-muted-foreground text-sm">
            Open the Glint extension icon popup to pair with your account first.
          </p>
          {running && (
            <button
              type="button"
              onClick={handleStop}
              className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors"
            >
              Stop
            </button>
          )}
        </>
      ) : (
        <>
          <form onSubmit={handleStart} className="flex flex-col gap-2">
            <label className="text-sm font-medium">Who are you looking for?</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me CEOs of ecommerce startups"
              className="border-border bg-card min-h-20 resize-none rounded-[var(--radius)] border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              required
              disabled={running}
            />
            {!running ? (
              <button
                type="submit"
                className="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={query.trim().length === 0}
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          {(running || status) && (
            <div className="border-border bg-card flex flex-col gap-1 rounded-[var(--radius)] border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold tabular-nums">{leadCount}</span>
                <span
                  className={
                    "flex items-center gap-1.5 text-xs font-medium " +
                    (running ? "text-primary" : "text-muted-foreground")
                  }
                >
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (running ? "bg-primary animate-pulse" : "bg-muted-foreground")
                    }
                  />
                  {running ? "Running" : "Idle"}
                </span>
              </div>
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>Leads found</span>
                {startedAt !== null && (
                  <span className="tabular-nums">
                    {formatElapsed(startedAt, now)} / {maxMinutes}:00
                  </span>
                )}
              </div>
              {status && <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-xs">{status}</p>}
            </div>
          )}
          <p className="text-muted-foreground border-border mt-auto border-t pt-2 text-xs">
            Glint scores what LinkedIn renders on the results list. It never opens
            profiles, and scores are estimates.
          </p>
        </>
      )}
    </div>
  )
}
