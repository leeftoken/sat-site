export const SAT_REFRESH_INTERVAL_MS = 30_000;
export const SAT_STALE_AFTER_MS = SAT_REFRESH_INTERVAL_MS + 15_000;

export type DataQuality = "loading" | "live" | "limited" | "partial" | "stale";

/**
 * Classify the last completed dashboard refresh. A stale timestamp outranks
 * the last refresh's partial/limited result; only complete, multi-node data
 * inside the freshness window is labelled LIVE.
 */
export function classifyDataQuality(
  ageMs: number | null,
  hasErrors: boolean,
  singleSource: boolean,
  staleAfterMs = SAT_STALE_AFTER_MS,
): DataQuality {
  if (ageMs === null || !Number.isFinite(ageMs)) return "loading";
  if (ageMs < 0 || ageMs > staleAfterMs) return "stale";
  if (hasErrors) return "partial";
  if (singleSource) return "limited";
  return "live";
}

/** Healthy data stays fast; repeated degraded reads back off to protect public RPCs. */
export function nextRefreshDelayMs(degradedStreak = 0): number {
  const step = Math.min(2, Math.max(0, Math.floor(Number.isFinite(degradedStreak) ? degradedStreak : 0)));
  return SAT_REFRESH_INTERVAL_MS * (2 ** step);
}
