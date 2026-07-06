"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

type Pairing = {
  id: string
  paired_at: string | null
  created_at: string
}

export function PairingPanel() {
  const supabase = createClient()
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pairings, setPairings] = useState<Pairing[]>([])

  const loadPairings = useCallback(async () => {
    const { data } = await supabase
      .from("extension_pairings")
      .select("id, paired_at, created_at")
      .order("created_at", { ascending: false })
    setPairings((data ?? []) as Pairing[])
  }, [supabase])

  useEffect(() => {
    loadPairings()
  }, [loadPairings])

  async function generate() {
    setLoading(true)
    const { data, error } = await supabase.functions.invoke<{
      pairing_code: string
    }>("create-pairing", { method: "POST" })
    setLoading(false)
    if (!error && data) {
      setCode(data.pairing_code)
      loadPairings()
    }
  }

  async function revoke(id: string) {
    await supabase.from("extension_pairings").delete().eq("id", id)
    loadPairings()
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-medium">Connect extension</h1>
        <p className="text-muted-foreground text-sm">
          Generate a code, then paste it into the Glint extension popup. Codes
          expire in 10 minutes.
        </p>
        <Button onClick={generate} disabled={loading} className="self-start">
          {loading ? "Generating..." : "Generate pairing code"}
        </Button>
        {code && (
          <p className="rounded-md border p-3 text-center font-mono text-2xl tracking-widest">
            {code}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Paired devices</h2>
        {pairings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pairings yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pairings.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <span>
                  {p.paired_at
                    ? `Paired ${new Date(p.paired_at).toLocaleString()}`
                    : "Pending — code not yet used"}
                </span>
                <Button size="sm" variant="outline" onClick={() => revoke(p.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
