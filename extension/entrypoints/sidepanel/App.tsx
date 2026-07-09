import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  adoptLegacyPairing,
  getActiveSiteId,
  getDeviceToken,
  listPairings,
  setActiveSite,
  type Pairing,
} from "@/lib/pairing"
import { getRunState } from "@/lib/run"
import { getPanelState, setPanelState } from "@/lib/panel-state"
import { sendRuntimeMessage, type RuntimeMessage } from "@/lib/messages"
import { EMPTY_FILTER, type LeadFilter } from "@/lib/filter"
import {
  listLeads,
  updateMinScore,
  type LeadCursor,
  type LeadRow as Lead,
} from "@/lib/leads"
import { assignFolder, createFolder, type FolderRow } from "@/lib/folders"
import { DEFAULT_THEME, getTheme, setTheme, type Theme } from "@/lib/theme"
import { DEFAULT_MAX_PAGES, LINKEDIN_MAX_PAGE } from "@/lib/agent-step"
import { profilePathFromUrl } from "@/lib/enrich"
import { DAILY_PROFILE_VIEW_BUDGET, type EnrichTarget } from "@/lib/enrich-pass"
import { FilterBar } from "@/components/filter-bar"
import { LeadList } from "@/components/lead-list"
import { IcpChips } from "@/components/icp-chips"
import { FolderPicker } from "@/components/folder-picker"

type Screen = "folder" | "query"

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

/**
 * The loaded leads that a contact-info pass could still learn something from.
 *
 * `enriched_at !== null` means "already looked up", whether or not an email was
 * found — re-visiting those profiles would spend LinkedIn's budget to learn
 * nothing. A lead whose linkedin_url doesn't yield an `/in/` path has no
 * contact-info overlay to open, so it is skipped rather than queued to fail.
 */
/**
 * A run *destination* expressed as a lead *filter*.
 *
 * The two vocabularies collide on `null` and mean opposite things: a
 * destination's `null` is "unfiled", while a filter's `null` is "every folder".
 * The filter spells unfiled as `""`. Translating in one named place is the only
 * thing standing between "show me the folder I just picked" and "show me
 * everything".
 */
function folderIdToFilter(destination: string | null): string {
  return destination ?? ""
}

function enrichableLeads(leads: Lead[]): EnrichTarget[] {
  const targets: EnrichTarget[] = []
  for (const lead of leads) {
    if (lead.enriched_at !== null) continue
    const profilePath = profilePathFromUrl(lead.linkedin_url)
    if (profilePath) targets.push({ leadId: lead.id, profilePath })
  }
  return targets
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
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)
  // Guards the query-persistence effect below from firing (and overwriting
  // glint_panel with an empty query) before the mount effect has rehydrated
  // state from it.
  const [hydrated, setHydrated] = useState(false)
  const [screen, setScreen] = useState<Screen>("folder")
  // The run's destination. `null` = Unfiled. Distinct from `filter.folderId`,
  // whose `null` means "all folders" — never assign one to the other.
  const [destination, setDestination] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX_PAGES)
  const [running, setRunning] = useState(false)
  // A paused run is neither running nor gone: it still owns its window, keeps
  // its page and its `seen` set, and resumes without rescoring. The panel must
  // offer Resume, not Start — Start would refuse anyway (glint_run still exists).
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [leadCount, setLeadCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Spec §5 asks the panel to show elapsed time against the run's cap, and §6
  // asks the accuracy caveat to stay visible. Neither shipped originally.
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [maxMinutes, setMaxMinutes] = useState(240)
  const [now, setNow] = useState(() => Date.now())

  // The standalone contact-info pass. Independent of a run: scanning a results
  // page is free, visiting a profile is not.
  const [enriching, setEnriching] = useState(false)
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null)

  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)
  useEffect(() => {
    getTheme().then(setThemeState)
  }, [])

  // setTheme writes storage AND stamps data-theme on <html>, so the CSS follows
  // without a re-render. The local state exists only to label the button.
  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "light" ? "dark" : "light"
      setTheme(next)
      return next
    })
  }, [])

  // --- lead list ---
  const [filter, setFilter] = useState<LeadFilter>(EMPTY_FILTER)
  const [searchInput, setSearchInput] = useState("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [cursor, setCursor] = useState<LeadCursor | null>(null)
  const [belowThresholdCount, setBelowThresholdCount] = useState(0)
  const [targetCountries, setTargetCountries] = useState<string[]>([])
  // ICP columns that seed the query-composition chips. Shipped by list-leads on
  // the same response as the leads, so they cost no extra round-trip.
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [companyTypes, setCompanyTypes] = useState<string[]>([])
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
  const queryRef = useRef<HTMLTextAreaElement | null>(null)

  // Ticks while paused too. The time cap is measured from startedAt and pausing
  // does not stop that clock, so freezing the readout would tell the user they
  // have more time than they do.
  useEffect(() => {
    if ((!running && !paused) || startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running, paused, startedAt])

  useEffect(() => {
    // The side panel document is unloaded/remounted whenever Chrome disables
    // it for the active tab (e.g. the user switches to a non-LinkedIn tab
    // and back), so on every mount we must rehydrate from glint_run — not
    // just re-check pairing — or an in-flight run becomes invisible/
    // unstoppable and Start would fire a second, overlapping run.
    Promise.all([getDeviceToken(), getRunState(), getPanelState()]).then(
      async ([token, run, panel]) => {
        if (run) {
          setRunning(run.status === "running")
          setPaused(run.status === "paused")
          setQuery(run.query)
          setLeadCount(run.leadCount)
          setStatus(run.status === "paused" ? "Paused" : "Run in progress…")
          // Rehydrating the true start time matters: the panel is remounted every
          // time Chrome disables it for a non-LinkedIn tab and re-enables it, and
          // an elapsed timer that restarted from zero on each remount would tell
          // the user the run is younger than it is, right up until the cap fires.
          setStartedAt(run.startedAt)
          setMaxMinutes(run.maxMinutes)
          // An in-flight run has already chosen its destination; skip the picker
          // straight to the query screen, which shows the run's own controls.
          setDestination(run.folderId)
          setFilter((f) => ({ ...f, folderId: folderIdToFilter(run.folderId) }))
          setScreen("query")
        } else {
          // No active run: restore the panel's pre-run choices. Without this, a
          // remount (e.g. the user switched away and back) would drop a picked
          // folder and a half-typed query back to the folder picker with
          // nothing filled in.
          setDestination(panel.destination)
          setQuery(panel.query)
          setScreen(panel.destinationChosen ? "query" : "folder")
          // Re-scope the list to the folder the user had already chosen. Without
          // this a remount lands on the query screen showing every folder's
          // leads, which is the state the picker exists to avoid.
          if (panel.destinationChosen) {
            setFilter((f) => ({ ...f, folderId: folderIdToFilter(panel.destination) }))
          }
        }
        setPaired(token !== null)
        // Populate the switcher before the first list-leads round-trip, so a
        // multi-site panel does not flash the single-site caption on mount.
        setPairings(await listPairings())
        setActiveSiteId(await getActiveSiteId())
        setHydrated(true)
      }
    )
  }, [])

  // Persists the in-progress query so a remount (Chrome disables/re-enables
  // the panel on a tab switch) does not discard it. Debounced on the same
  // interval as the search box below rather than written per keystroke: a
  // fast typist would otherwise fire a storage.local write on every
  // character, and the loss window a debounce reopens (a remount landing
  // mid-keystroke) is negligible next to that cost. Gated on `hydrated` so
  // this can't fire with the empty initial query before rehydration has had
  // a chance to restore the real one.
  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => {
      setPanelState({ query })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, hydrated])

  useEffect(() => {
    function onMessage(message: RuntimeMessage) {
      if (message.type === "PROGRESS") {
        setLeadCount(message.leadCount)
        setStatus(message.status)
        // A PROGRESS can only come from a running content script, so it is also
        // the authoritative "we resumed" signal — the background does not
        // broadcast one.
        setRunning(true)
        setPaused(false)
      } else if (message.type === "PAUSED") {
        setRunning(false)
        setPaused(true)
        setStatus(message.message)
        // A pause is a good moment to see what the run has stored so far.
        setRefreshKey((k) => k + 1)
      } else if (message.type === "STOPPED") {
        setRunning(false)
        setPaused(false)
        setStartedAt(null)
        setStatus(message.reason)
        // The run just wrote leads the list can't know about.
        setRefreshKey((k) => k + 1)
      } else if (message.type === "RUN_ERROR") {
        setRunning(false)
        setPaused(false)
        setStartedAt(null)
        setError(message.error)
      } else if (message.type === "ENRICH_PROGRESS") {
        setEnriching(true)
        setEnrichStatus(message.status)
      } else if (message.type === "ENRICH_STOPPED") {
        setEnriching(false)
        setEnrichStatus(message.reason)
        // Contact info just landed on rows the list is already showing.
        setRefreshKey((k) => k + 1)
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
      .then(async (res) => {
        setLeads(res.leads)
        setCursor(res.next_cursor)
        setBelowThresholdCount(res.below_threshold_count)
        setTargetCountries(res.target_countries)
        setTargetRoles(res.target_roles)
        setCompanyTypes(res.company_types)
        setHasIcp(res.has_icp)
        // A token stored before sites existed has no entry in the pairing map.
        // list-leads is the first thing the panel calls, and it reports which
        // site the server resolved, so this is where the token gets re-keyed.
        // adoptLegacyPairing is a no-op once the map holds an entry.
        if (res.site) {
          await adoptLegacyPairing(res.site.id, res.site.name)
          setPairings(await listPairings())
          setActiveSiteId(await getActiveSiteId())
        }
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
    // filter.minScore against it. activeSiteId participates because the request
    // carries the active site's token: switching site must refetch, or the panel
    // keeps showing the previous website's leads.
  }, [paired, filter, revealed, savedMinScore, refreshKey, activeSiteId])

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
  /**
   * `selectAsDestination` is what keeps the panel's two folder vocabularies
   * apart. Creating a folder from the picker is the user choosing where THIS RUN
   * writes, so the new folder becomes the destination. Creating one from the
   * FilterBar is the user organising the lead list they are reading, and must
   * not silently retarget the next run.
   */
  const createFolderNamed = useCallback(
    async (name: string, selectAsDestination: boolean): Promise<boolean> => {
      setCreatingFolder(true)
      setCreateFolderError(null)
      try {
        // Snapshot ids before the mutation lands, so the newly created folder can
        // be told apart from one that happened to share its name (the server
        // 409s on duplicates, so this should be impossible, but prefer the id
        // that wasn't already here if it somehow occurs).
        const priorIds = new Set(folders.map((f) => f.id))
        const updated = await createFolder(name)
        setFolders(updated)
        if (selectAsDestination) {
          // Otherwise the user has to create the folder and then click it.
          const matches = updated.filter((f) => f.name === name)
          const created = matches.find((f) => !priorIds.has(f.id)) ?? matches.at(-1)
          if (created) setDestination(created.id)
        }
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
    },
    [folders]
  )

  const handleCreateDestinationFolder = useCallback(
    (name: string) => createFolderNamed(name, true),
    [createFolderNamed]
  )

  const handleCreateFilterFolder = useCallback(
    (name: string) => createFolderNamed(name, false),
    [createFolderNamed]
  )

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
    sendRuntimeMessage({ type: "START_RUN", query: trimmed, maxPages, folderId: destination })
  }

  function handleStop() {
    sendRuntimeMessage({ type: "STOP_RUN" })
    setRunning(false)
    setPaused(false)
    setStartedAt(null)
  }

  function handlePause() {
    sendRuntimeMessage({ type: "PAUSE_RUN", reason: "user" })
    setRunning(false)
    setPaused(true)
  }

  function handleResume() {
    sendRuntimeMessage({ type: "RESUME_RUN" })
    setPaused(false)
    setRunning(true)
    setStatus("Resuming…")
  }

  // Leads on screen that have never had a contact-info lookup, and whose
  // linkedin_url yields a usable /in/ path. `enriched_at` is the load-bearing
  // field: a lead with it set has been looked up, whether or not anything was
  // found, and must not be visited a second time.
  const enrichTargets: EnrichTarget[] = enrichableLeads(leads)

  function handleEnrich() {
    if (enrichTargets.length === 0) return
    setEnrichStatus(null)
    setEnriching(true)
    sendRuntimeMessage({ type: "START_ENRICH", targets: enrichTargets })
  }

  function handleStopEnrich() {
    sendRuntimeMessage({ type: "STOP_ENRICH" })
  }

  // The folder picker owns the whole panel while it is up. A live or paused run
  // has already chosen its destination, so it must never be sent back to it.
  const onFolderScreen = screen === "folder" && !running && !paused

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

  // The `?? "Unfiled"` matters: the selected folder can be deleted in the web
  // app while the panel sits on the query screen, and a label reading
  // `undefined` is worse than one that is merely stale. The authoritative check
  // is server-side (score-lead's `invalid_folder`).
  const destinationLabel =
    destination === null
      ? "Unfiled"
      : (folders.find((f) => f.id === destination)?.name ?? "Unfiled")

  if (paired === null) {
    return (
      <div className="bg-background text-foreground flex h-full items-center justify-center p-4 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="bg-background text-foreground flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-base font-semibold">Glint</h1>
          {/* One website is not a choice, so it is a caption, not a control.
              Disabled during a run: the run pinned its site at start, and a
              switch here would only mislead about where leads are landing. */}
          {pairings.length > 1 ? (
            <select
              value={activeSiteId ?? ""}
              disabled={running}
              aria-label="Active website"
              onChange={async (e) => {
                const next = e.target.value
                await setActiveSite(next)
                setActiveSiteId(next)
              }}
              className="border-border bg-card max-w-full truncate rounded-md border px-2 py-1 text-xs disabled:opacity-50"
            >
              {pairings.map((p) => (
                <option key={p.siteId} value={p.siteId}>
                  {p.siteName}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-muted-foreground text-xs">
              Find and score LinkedIn leads against your ICP
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          className="border-border bg-card hover:bg-accent shrink-0 rounded-[var(--radius)] border px-2 py-1 text-xs transition-colors"
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
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
          {/* WHERE before WHO: a run chooses its destination before its query,
              and the picker is the ONLY thing on screen while it does. Showing
              every folder's leads underneath a question about which folder to
              use answered the question before it was asked. Once a folder is
              chosen, the list below is scoped to it. A run in progress (or a
              paused one) forces the query screen: it must show its own controls,
              never the picker. */}
          {onFolderScreen ? (
            <FolderPicker
              folders={folders}
              selected={destination}
              onSelect={setDestination}
              onContinue={() => {
                setPanelState({ destination, destinationChosen: true })
                setFilter((f) => ({ ...f, folderId: folderIdToFilter(destination) }))
                setScreen("query")
              }}
              onCreateFolder={handleCreateDestinationFolder}
              creating={creatingFolder}
              createError={createFolderError}
            />
          ) : (
          <>
          <form onSubmit={handleStart} className="flex flex-col gap-2">
            {!running && (
              <button
                type="button"
                onClick={() => {
                  setPanelState({ destinationChosen: false })
                  // Back to "every folder" — the picker is about to ask which one,
                  // and leaving the old scope on would filter the folders' own
                  // lead counts to the folder being replaced.
                  setFilter((f) => ({ ...f, folderId: null }))
                  setScreen("folder")
                }}
                className="text-muted-foreground hover:text-foreground self-start text-xs"
              >
                ‹ {destinationLabel}
              </button>
            )}
            <label className="text-sm font-medium">Who are you looking for?</label>
            {/* Tappable chips drawn from the user's own ICP. Tapping one fills
                the query box; nothing runs until Start. Selection is derived
                from the query text, so hand-editing the textarea keeps the chips
                honest. Renders nothing unless the ICP actually has chips. */}
            {hasIcp === true && (
              <IcpChips
                roles={targetRoles}
                companies={companyTypes}
                countries={targetCountries}
                query={query}
                onChange={setQuery}
                disabled={running}
              />
            )}
            <textarea
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find me CEOs of ecommerce startups"
              className="border-border bg-card focus-visible:ring-ring min-h-20 resize-none rounded-[var(--radius)] border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
              required
              disabled={running}
            />
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="max-pages" className="text-xs font-medium">
                Pages to scan
              </label>
              <input
                id="max-pages"
                type="number"
                min={1}
                max={LINKEDIN_MAX_PAGE}
                value={maxPages}
                disabled={running || paused}
                onChange={(e) => {
                  // An empty input yields 0 (not NaN). Clamp it: a 0 persisted
                  // into RunState makes nextAction's `page >= maxPages` true on
                  // page 1, so the run would stop before scanning anything. The
                  // upper clamp is LinkedIn's own ceiling — past page 100 it
                  // returns no new results.
                  const n = Number(e.target.value)
                  setMaxPages(
                    Number.isFinite(n)
                      ? Math.min(LINKEDIN_MAX_PAGE, Math.max(1, Math.trunc(n)))
                      : 1
                  )
                }}
                className="border-border bg-card focus-visible:ring-ring w-16 rounded-[var(--radius)] border px-2 py-1 text-sm outline-none focus-visible:ring-2 disabled:opacity-50"
              />
            </div>
            {!running && !paused ? (
              <button
                type="submit"
                className="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={query.trim().length === 0}
              >
                Start
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={paused ? handleResume : handlePause}
                  className="bg-primary text-primary-foreground flex-1 rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
                >
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="border-border bg-card hover:bg-accent flex-1 rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors"
                >
                  Stop
                </button>
              </div>
            )}
          </form>

          {error && <p className="text-destructive text-sm">{error}</p>}

          {(running || paused || status) && (
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
                  {running ? "Running" : paused ? "Paused" : "Idle"}
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

          {/* Contact-info lookup. Deliberately a separate, explicit action
              rather than something a run does on its own: scanning a results
              page is free, but opening a lead's profile spends LinkedIn's
              commercial-use budget and is what gets accounts restricted. */}
          {(enrichTargets.length > 0 || enriching || enrichStatus) && (
            <div className="border-border bg-card flex flex-col gap-2 rounded-[var(--radius)] border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Contact info</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  max {DAILY_PROFILE_VIEW_BUDGET}/day
                </span>
              </div>
              {enriching ? (
                <button
                  type="button"
                  onClick={handleStopEnrich}
                  className="border-border bg-card hover:bg-accent rounded-[var(--radius)] border px-3 py-1.5 text-sm transition-colors"
                >
                  Stop lookup
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEnrich}
                  disabled={enrichTargets.length === 0}
                  className="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Look up {enrichTargets.length} lead
                  {enrichTargets.length === 1 ? "" : "s"}
                </button>
              )}
              {enrichStatus && (
                <p className="text-muted-foreground text-xs">{enrichStatus}</p>
              )}
              <p className="text-muted-foreground text-xs">
                Visits each profile in a background tab. LinkedIn counts these
                against your monthly limit.
              </p>
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
            onCreateFolder={handleCreateFilterFolder}
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
            Glint scores what LinkedIn renders on the results list. A run never
            opens profiles, and scores are estimates.
          </p>
          </>
          )}
        </>
      )}
    </div>
  )
}
