import { useEffect, useState } from "react"
import { getDeviceToken } from "@/lib/pairing"

export default function App() {
  const [paired, setPaired] = useState<boolean | null>(null)

  useEffect(() => {
    getDeviceToken().then((t) => setPaired(t !== null))
  }, [])

  if (paired === null) {
    return <div className="p-4 text-sm">Loading…</div>
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="text-base font-semibold">Glint</h1>
      {paired ? (
        <p className="text-sm text-green-600">Extension paired ✓</p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Open the Glint extension icon popup to pair with your account first.
        </p>
      )}
    </div>
  )
}
