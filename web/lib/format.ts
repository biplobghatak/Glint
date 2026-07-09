/**
 * Storage keeps `match_score` on 0-100 because the model reasons with
 * meaningfully more gradations there than on 0-10. The user thinks in 0-10.
 *
 * This is the web app's half of that boundary; the extension has its own copy at
 * extension/lib/format.ts. The two cannot share a module (separate bundles), so
 * they must change together.
 *
 * Only rendered text goes through here. Every comparison — score buckets, the
 * `>= 80` badge variant, `icps.min_score` — stays on the 0-100 scale.
 *
 *   85 -> "8.5"
 */
export function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

/** `null` is a lead that was never scored, which is not the same as a zero. */
export function formatScoreOrDash(score: number | null): string {
  return score === null ? "—" : formatScore(score)
}
