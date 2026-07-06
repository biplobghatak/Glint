import { useEffect, useState, type FormEvent } from "react"
import { clearDeviceToken, getDeviceToken, pair } from "@/lib/pairing"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getDeviceToken().then((t) => setPaired(t !== null))
  }, [])

  async function handlePair(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(false)
    try {
      await pair(code.trim())
      setPaired(true)
      setCode("")
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleUnpair() {
    await clearDeviceToken()
    setPaired(false)
  }

  if (paired === null) {
    return <div className="w-72 p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex w-72 flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {paired ? (
        <>
          <p className="text-sm text-green-600">Extension paired ✓</p>
          <button
            onClick={handleUnpair}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Unpair
          </button>
        </>
      ) : (
        <form onSubmit={handlePair} className="flex flex-col gap-2">
          <label className="text-sm">
            Paste your pairing code from Glint → Settings.
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXXXXX"
            className="rounded-md border px-3 py-1.5 font-mono tracking-widest uppercase"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
          {error && (
            <p className="text-sm text-red-600">
              Invalid or expired code. Generate a new one.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
