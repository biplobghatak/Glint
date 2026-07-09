import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { getDeviceToken } from "@/lib/pairing"
import { getRunState } from "@/lib/run"
import type { RuntimeMessage } from "@/lib/messages"
import { EMPTY_FILTER, type LeadFilter } from "@/lib/filter"
import {
  listLeads,
  updateMinScore,
  type LeadCursor,
  type LeadRow as Lead,
} from "@/lib/leads"
import { assignFolder, createFolder, type FolderRow } from "@/lib/folders"
import { FilterBar } from "@/components/filter-bar"
import { LeadList } from "@/components/lead-list"

const SEARCH_DEBOUNCE_MS = 250
const THRESHOLD_DEBOUNCE_MS = 400
const DEFAULT_MIN_SCORE = 70

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

// Chips the user can pick from: the ICP's target geography, plus any country
// actually present on the rows loaded so far. Unknown is prepended by FilterBar.
function countryChips(targetCountries: string[], leads: Lead[]): string[] {
  const set = new Set(targetCountries)
  for (const lead of leads) {
    if (lead.country) set.add(lead.country)
  }
  return Array.from(set).sort()
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

  // --- lead list ---
  const [filter, setFilter] = useState<LeadFilter>(EMPTY_FILTER)
  const [searchInput, setSearchInput] = useState("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [cursor, setCursor] = useState<LeadCursor | null>(null)
  const [belowThresholdCount, setBelowThresholdCount] = useState(0)
  const [targetCountries, setTargetCountries] = useState<string[]>([])
  // The user's saved icps.min_score. Only ever changes after update-icp
  // confirms the write, so the list is never refetched against a threshold the
  // server hasn't stored yet.
  const [savedMinScore, setSavedMinScore] = useState(DEFAULT_MIN_SCORE)
  // What the slider shows: tracks the drag optimistically, ahead of the write.
  const [sliderValue, setSliderValue] = useState(DEFAULT_MIN_SCORE)
  const [hasIcp, setHasIcp] = useState<boolean | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // --- folders ---
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [createFolderError, setCreateFolderError] = useState<string | null>(null)
  // Says out loud that the selected folder vanished. Silently resetting to "All
  // folders" would look like the filter simply stopped working.
  const [folderNotice, setFolderNotice] = useState<string | null>(null)
  // Bumped to force a refetch when nothing in `filter` changed — e.g. a run
  // just ended and wrote new leads.
  const [refreshKey, setRefreshKey] = useState(0)

  const listAbortRef = useRef<AbortController | null>(null)
  const thresholdTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
        // The run just wrote leads the list can't know about.
        setRefreshKey((k) => k + 1)
      } else if (message.type === "RUN_ERROR") {
        setRunning(false)
        setStartedAt(null)
        setError(message.error)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  // Debounce the search box into the filter. Typing must not fire a request per
  // keystroke, and every filter change resets pagination to the first page —
  // carrying a cursor forward returns a page from the middle of the old result
  // set.
  useEffect(() => {
    if (searchInput === filter.q) return
    const id = setTimeout(
      () => setFilter((f) => ({ ...f, q: searchInput })),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(id)
  }, [searchInput, filter.q])

  // Fetch page one whenever the filter, the reveal toggle, or the saved
  // threshold changes. An in-flight request for a stale filter is aborted, not
  // awaited: without cancellation a fast typist gets responses out of order and
  // the list flickers backward.
  useEffect(() => {
    if (paired !== true) return

    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller

    setListLoading(true)
    setListError(null)

    // revealed drops the threshold to 0 for this request only; it never writes
    // icps.min_score.
    const requestFilter: LeadFilter = revealed ? { ...filter, minScore: 0 } : filter

    listLeads(requestFilter, null, controller.signal)
      .then((res) => {
        setLeads(res.leads)
        setCursor(res.next_cursor)
        setBelowThresholdCount(res.below_threshold_count)
        setTargetCountries(res.target_countries)
        setHasIcp(res.has_icp)
        setSavedMinScore(res.min_score)
        setSliderValue((v) => (v === res.min_score ? v : res.min_score))
        setFolders(res.folders)
        setListLoading(false)

        // The selected folder was deleted in the web app while the panel had it
        // filtered. Its uuid is now dead, and list-leads answers with an empty
        // page that reads as "no leads match" rather than "that folder is gone".
        // Only a uuid can go stale: null and "" always exist.
        const selected = filter.folderId
        if (selected && !res.folders.some((f) => f.id === selected)) {
          setFolderNotice("That folder was deleted. Showing all folders.")
          setFilter((f) => ({ ...f, folderId: null }))
        }
      })
      .catch((err: unknown) => {
        // An aborted request was superseded by a newer one; the newer one owns
        // the loading state.
        if (isAbort(err)) return
        setListError(err instanceof Error ? err.message : "Couldn't load leads")
        setListLoading(false)
      })

    return () => controller.abort()
    // savedMinScore participates because the server resolves a null
    // filter.minScore against it.
  }, [paired, filter, revealed, savedMinScore, refreshKey])

  const handleLoadMore = useCallback(() => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const requestFilter: LeadFilter = revealed ? { ...filter, minScore: 0 } : filter
    // Its own controller: a "load more" must not be cancelled by, nor cancel,
    // the page-one effect.
    const controller = new AbortController()
    listLeads(requestFilter, cursor, controller.signal)
      .then((res) => {
        setLeads((prev) => [...prev, ...res.leads])
        setCursor(res.next_cursor)
        setLoadingMore(false)
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setListError(err instanceof Error ? err.message : "Couldn't load more leads")
        setLoadingMore(false)
      })
  }, [cursor, loadingMore, filter, revealed])

  // Slider moves immediately; the write (and the refetch it triggers) is
  // debounced, so dragging across 0-100 doesn't fire 20 updates.
  const handleMinScoreChange = useCallback((value: number) => {
    setSliderValue(value)
    clearTimeout(thresholdTimerRef.current)
    thresholdTimerRef.current = setTimeout(() => {
      updateMinScore(value)
        .then((persisted) => setSavedMinScore(persisted))
        .catch((err: unknown) => {
          setListError(err instanceof Error ? err.message : "Couldn't save threshold")
        })
    }, THRESHOLD_DEBOUNCE_MS)
  }, [])

  useEffect(() => () => clearTimeout(thresholdTimerRef.current), [])

  // manage-folders answers with the whole post-mutation list, so there is no
  // local merge to get wrong. Resolves false on failure and the FilterBar keeps
  // what the user typed.
  const handleCreateFolder = useCallback(async (name: string): Promise<boolean> => {
    setCreatingFolder(true)
    setCreateFolderError(null)
    try {
      setFolders(await createFolder(name))
      return true
    } catch (err: unknown) {
      // A 409 carries the server's "A folder named X already exists".
      setCreateFolderError(
        err instanceof Error ? err.message : "Couldn't create that folder"
      )
      return false
    } finally {
      setCreatingFolder(false)
    }
  }, [])

  const handleAssignFolder = useCallback(
    (leadId: string, folderId: string | null) => {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead || lead.folder_id === folderId) return

      const prevLeads = leads
      const prevFolders = folders
      const oldFolderId = lead.folder_id

      // A lead's membership expressed in the filter's own vocabulary: "" is
      // unfiled, matching LeadFilter.folderId's sentinel.
      const membership = folderId ?? ""
      // With a folder filter active, a lead moved elsewhere no longer belongs
      // on screen. Leaving it there would show it under a folder it isn't in.
      const dropped = filter.folderId !== null && membership !== filter.folderId

      setLeads((cur) =>
        dropped
          ? cur.filter((l) => l.id !== leadId)
          : cur.map((l) => (l.id === leadId ? { ...l, folder_id: folderId } : l))
      )
      // Adjust counts in place rather than refetching: a refetch would reset
      // pagination and throw away every "load more" page the user has opened.
      setFolders((cur) =>
        cur.map((f) => ({
          ...f,
          lead_count:
            f.lead_count + (f.id === folderId ? 1 : 0) - (f.id === oldFolderId ? 1 : 0),
        }))
      )

      assignFolder(leadId, folderId).catch((err: unknown) => {
        // A lead silently sitting in the wrong folder is worse than an error.
        setLeads(prevLeads)
        setFolders(prevFolders)
        setListError(err instanceof Error ? err.message : "Couldn't move that lead")
      })
    },
    [leads, folders, filter.folderId]
  )

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

  // Keeps the previous rows painted while a new filter's results are in flight.
  const visibleLeads = useDeferredValue(leads)
  const chips = countryChips(targetCountries, visibleLeads)
  // folderId !== null covers both "unfiled" ("") and a specific folder; an empty
  // result under either is a filter miss, not an empty inbox.
  const filtersActive =
    filter.q.length > 0 ||
    filter.countries.length > 0 ||
    filter.status.length > 0 ||
    filter.folderId !== null

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
      ) : hasIcp === false ? (
        // Paired, but no ICP: scoring a lead requires one, so there is nothing
        // to search for and nothing to list. Until list-leads existed the panel
        // had no way to ask this question.
        <div className="border-border bg-card flex flex-col gap-2 rounded-[var(--radius)] border p-3">
          <p className="text-sm font-medium">Finish setting up your ICP</p>
          <p className="text-muted-foreground text-xs">
            Glint scores every lead against your ideal customer profile. Create one in
            the web app, then come back here to start a run.
          </p>
        </div>
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
              {status && (
                <p className="text-muted-foreground border-border mt-1 border-t pt-1 text-xs">
                  {status}
                </p>
              )}
            </div>
          )}

          <FilterBar
            filter={filter}
            onChange={setFilter}
            query={searchInput}
            onQueryChange={setSearchInput}
            countries={chips}
            minScore={sliderValue}
            onMinScoreChange={handleMinScoreChange}
            folders={folders}
            onCreateFolder={handleCreateFolder}
            creatingFolder={creatingFolder}
            createFolderError={createFolderError}
          />

          {folderNotice && (
            <p className="text-muted-foreground text-xs">
              {folderNotice}{" "}
              <button
                type="button"
                onClick={() => setFolderNotice(null)}
                className="text-primary underline"
              >
                Dismiss
              </button>
            </p>
          )}

          <LeadList
            leads={visibleLeads}
            minScore={savedMinScore}
            loading={listLoading}
            error={listError}
            belowThresholdCount={belowThresholdCount}
            revealed={revealed}
            onToggleReveal={() => setRevealed((r) => !r)}
            hasMore={cursor !== null}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            filtersActive={filtersActive}
            folders={folders}
            onAssignFolder={handleAssignFolder}
          />

          <p className="text-muted-foreground border-border mt-auto border-t pt-2 text-xs">
            Glint scores what LinkedIn renders on the results list. It never opens
            profiles, and scores are estimates.
          </p>
        </>
      )}
    </div>
  )
}
