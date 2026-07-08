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
import { PageHeader } from "@/components/app-shell/page-header"

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
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Connect extension</CardTitle>
            <CardDescription>
              Generate a code, then paste it into the Glint extension popup.
              Codes expire in 10 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={generate} disabled={loading} className="self-start">
              {loading ? "Generating..." : "Generate pairing code"}
            </Button>
            {code && (
              <p className="border border-border p-3 text-center font-mono text-2xl tracking-widest">
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
              <p className="text-sm text-muted-foreground">No pairings yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pairings.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between border border-border p-3 text-sm"
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
    </>
  )
}
