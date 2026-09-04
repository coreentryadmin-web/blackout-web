/** Member-visible HELIX banner only surfaces anomalies detected within this window. */
export const FLOW_ANOMALY_RECENCY_MS = 15 * 60 * 1000;

/**
 * Whether a flow anomaly's `detectedAt` is recent enough to show in FlowAnomalyBanner.
 * Future-dated timestamps (upstream or clock skew) are treated as not recent — the banner
 * must not flash for events that have not happened yet.
 */
export function isFlowAnomalyRecent(detectedAt: string, nowMs = Date.now()): boolean {
  const t = new Date(detectedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = nowMs - t;
  if (ageMs < 0) return false;
  return ageMs < FLOW_ANOMALY_RECENCY_MS;
}
