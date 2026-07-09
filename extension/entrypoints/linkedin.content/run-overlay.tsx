import { useEffect, useState } from "react"
import type { RuntimeMessage } from "@/lib/messages"
import type { RunState } from "@/lib/run"

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * Live progress for an autonomous run, rendered into the LinkedIn page itself.
 *
 * The side panel used to own this. A popup cannot: it unmounts on blur, so the
 * first click back into the page would destroy the only thing telling the user
 * their run is still going. The toolbar badge carries the lead count, but it
 * has room for nothing else — elapsed time, the last status line, and Stop all
 * have to live somewhere, and the page is the only surface that persists.
 *
 * Mounted only while a run owns THIS tab; see computeAgentActive in index.ts.
 */
export function RunOverlay({ initial }: { initial: RunState }) {
  const [leadCount, setLeadCount] = useState(initial.leadCount)
  const [status, setStatus] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [caveatDismissed, setCaveatDismissed] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function onMessage(message: RuntimeMessage) {
      if (message.type === "PROGRESS") {
        setLeadCount(message.leadCount)
        setStatus(message.status)
      } else if (message.type === "STOPPED") {
        // The overlay is about to be unmounted by index.ts's storage listener
        // anyway; showing the reason for the instant in between is not worth a
        // state branch that would have to be torn down.
        setStatus(message.reason)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  function handleStop() {
    chrome.runtime.sendMessage({ type: "STOP_RUN" } satisfies RuntimeMessage).catch(() => {})
  }

  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="row">
        <span className="count">{leadCount}</span>
        <span className="live">
          <span className="dot" />
          Running
        </span>
      </div>
      <div className="row">
        <span className="cap">
          {leadCount} of {initial.maxLeads} leads
        </span>
        <span className="elapsed">
          {formatElapsed(initial.startedAt, now)} / {initial.maxMinutes}:00
        </span>
      </div>
      <button type="button" className="stop" onClick={handleStop}>
        Stop search
      </button>
      {status && <p className="status">{status}</p>}
      {!caveatDismissed && (
        <div className="caveat">
          <span>
            Glint scores what LinkedIn renders on the results list. It never opens
            profiles, and scores are estimates.
          </span>
          <button type="button" onClick={() => setCaveatDismissed(true)}>
            Got it
          </button>
        </div>
      )}
    </div>
  )
}
