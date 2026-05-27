// Signal-group trend from the distribution of report times (pure, deterministic).
// Compares activity in the recent window vs the prior window of equal length.
// Inline grouping sets a provisional trend; Insight recomputes this at read time with wall-clock
// `now`, which is what makes `declining`/`stable` reachable (a group going quiet → declining).
export type Trend = 'new' | 'rising' | 'stable' | 'declining';

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function deriveTrend(times: number[], now: number, windowMs = WINDOW_MS): Trend {
  const valid = times.filter((t) => Number.isFinite(t));
  if (valid.length <= 1) return 'new';
  let recent = 0; // (now - window, now]
  let prior = 0; // (now - 2*window, now - window]
  for (const t of valid) {
    const age = now - t;
    if (age <= windowMs) recent++;
    else if (age <= 2 * windowMs) prior++;
  }
  if (recent === 0) return 'declining'; // no activity in the recent window
  if (prior === 0) return 'rising'; // activity concentrated in the recent window (growing)
  if (recent > prior) return 'rising';
  if (recent < prior) return 'declining';
  return 'stable';
}
