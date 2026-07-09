/**
 * Storage keeps `match_score` on 0-100 because the model reasons with
 * meaningfully more gradations there than on 0-10. The user thinks in 0-10.
 * This is the only place those two scales meet.
 *
 * 85 -> "8.5".
 */
export function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}
