"use client"

import { useState, type FormEvent } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Status = "idle" | "sending" | "sent" | "error"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus("sending")

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    })

    setStatus(error ? "error" : "sent")
  }

  if (status === "sent") {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <p>Check {email} for a magic link to sign in.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Sending..." : "Send magic link"}
        </Button>
        {status === "error" && (
          <p className="text-destructive text-sm">Something went wrong. Try again.</p>
        )}
      </form>
    </div>
  )
}
