/**
 * Vector SSE candle freshness bound for RTH minute audit.
 *
 * The probe holds the stream open for probeHoldMs and uses the last frame;
 * that frame's timestamp can lag by nearly the full hold window plus one
 * wallTrailSec bead interval. A fixed 8s cap false-FAILs at 5s trail cadence.
 */
export function maxVectorCandleFreshSec(wallTrailSec, probeHoldMs = 8000) {
  const trail =
    Number.isFinite(wallTrailSec) && wallTrailSec > 0 ? wallTrailSec : 5;
  const holdSec = Math.ceil(Math.max(0, probeHoldMs) / 1000);
  return Math.max(12, trail * 2 + holdSec + 2);
}

export function isVectorCandleStale(candleFreshSec, wallTrailSec, probeHoldMs = 8000) {
  if (candleFreshSec == null) return false;
  return candleFreshSec > maxVectorCandleFreshSec(wallTrailSec, probeHoldMs);
}
