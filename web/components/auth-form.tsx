"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Status = "idle" | "sending" | "sent" | "error"

type Mode = "login" | "signup"

const COPY: Record<
  Mode,
  {
    heading: string
    subtitle: string
    cta: string
    switchPrompt: string
    switchLabel: string
    switchHref: string
    sentBody: string
  }
> = {
  login: {
    heading: "Welcome back",
    subtitle: "Sign in with a magic link — no password needed.",
    cta: "Send magic link",
    switchPrompt: "Don't have an account?",
    switchLabel: "Sign up",
    switchHref: "/signup",
    sentBody: "Click it to sign in.",
  },
  signup: {
    heading: "Create your account",
    subtitle: "Start scoring leads in minutes — no password to set.",
    cta: "Create account",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/login",
    sentBody: "Click it to finish creating your account.",
  },
}

export function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const copy = COPY[mode]

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

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="text-xl font-bold tracking-tight">
        Glint<span className="text-primary">.</span>
      </Link>

      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        {status === "sent" ? (
          <div className="flex flex-col gap-2 text-center">
            <h1 className="text-lg font-semibold tracking-wide uppercase">
              Check your email
            </h1>
            <p className="text-sm text-muted-foreground">
              We sent a link to <span className="text-foreground">{email}</span>.{" "}
              {copy.sentBody}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col gap-1">
              <h1 className="text-lg font-semibold tracking-wide uppercase">
                {copy.heading}
              </h1>
              <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Sending..." : copy.cta}
              </Button>
              {status === "error" && (
                <p className="text-destructive text-sm">
                  Something went wrong. Try again.
                </p>
              )}
            </form>
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {copy.switchPrompt}{" "}
        <Link
          href={copy.switchHref}
          className="text-foreground underline underline-offset-4"
        >
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  )
}
