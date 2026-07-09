"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Pairing = {
  id: string
  paired_at: string | null
  created_at: string
}

export function PairingPanel({
  siteId,
  siteName,
}: {
  siteId: string
  siteName: string
}) {
  const supabase = createClient()
  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pairings, setPairings] = useState<Pairing[]>([])

  // A pairing key belongs to one website. Listing every site's keys here would
  // make it impossible to tell which browser is scanning for which product.
  const loadPairings = useCallback(async () => {
    const { data } = await supabase
      .from("extension_pairings")
      .select("id, paired_at, created_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
    setPairings((data ?? []) as Pairing[])
  }, [supabase, siteId])

  useEffect(() => {
    loadPairings()
  }, [loadPairings])

  async function generate() {
    setLoading(true)
    // create-pairing refuses to guess once a user has more than one site, so
    // the active site is always sent explicitly.
    const { data, error } = await supabase.functions.invoke<{
      pairing_code: string
    }>("create-pairing", { method: "POST", body: { site_id: siteId } })
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
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Connect extension</CardTitle>
          <CardDescription>
            Generate a code, then paste it into the Glint extension popup. The
            extension will scan for {siteName}. Codes expire in 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={generate} disabled={loading} className="self-start">
            {loading ? "Generating..." : "Generate pairing code"}
          </Button>
          {code && (
            <p className="border-border rounded-md border p-3 text-center font-mono text-2xl tracking-widest">
              {code}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paired devices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {pairings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pairings yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {pairings.map((p) => (
                <li
                  key={p.id}
                  className="border-border flex items-center justify-between rounded-md border p-3 text-sm"
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
        </CardContent>
      </Card>
    </div>
  )
}
