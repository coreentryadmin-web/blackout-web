/**
 * Pure Thermal desk helpers — URL state, per-layer freshness, compare universe.
 * Kept out of GexHeatmap.tsx so unit tests don't need the 4k-line React surface.
 */

export const THERMAL_COMPARE_TICKERS = ["SPY", "SPX", "QQQ"] as const;
export type ThermalCompareTicker = (typeof THERMAL_COMPARE_TICKERS)[number];

export type ThermalLens = "gex" | "vex" | "dex" | "charm";

const LENSES: readonly ThermalLens[] = ["gex", "vex", "dex", "charm"];

/** Matrix is live under ~2.5× the 5s poll; amber after that. */
export const MATRIX_LIVE_MS = 12_000;
export const MATRIX_STALE_MS = 15_000;
/**
 * When matrix `asof` is older than this during a live Thermal view, request `?force=1`
 * (server-throttled ≤1/8s) — same escape hatch SPX Slayer uses so SPY/QQQ don't sit on
 * the 1-minute heatmap-warm EventBridge floor while the client polls every 5s.
 */
export const MATRIX_FORCE_REFRESH_AGE_MS = 8_000;
/** Client-side spacing between force attempts (matches server FORCE_THROTTLE_MS). */
export const MATRIX_FORCE_THROTTLE_MS = 8_000;
/** Overlay cache is ~30s — treat as live under 45s. */
export const OVERLAY_LIVE_MS = 45_000;
export const OVERLAY_STALE_MS = 90_000;

export type ThermalFreshnessStatus = "live" | "stale" | "cached" | "offline" | "syncing";

export type ThermalLayerFreshness = {
  matrix: { status: ThermalFreshnessStatus; asOf: Date | null };
  overlays: { status: ThermalFreshnessStatus; asOf: Date | null; label: string };
  crossVal: { status: ThermalFreshnessStatus; asOf: Date | null; label: string };
};

export function isThermalCompareTicker(t: string): t is ThermalCompareTicker {
  return (THERMAL_COMPARE_TICKERS as readonly string[]).includes(t.toUpperCase());
}

export function parseThermalLens(raw: string | null | undefined): ThermalLens | null {
  if (!raw) return null;
  const l = raw.trim().toLowerCase() as ThermalLens;
  return LENSES.includes(l) ? l : null;
}

export function parseThermalTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,7}$/.test(t) ? t : null;
}

/** Read desk state from URLSearchParams (client). */
export function parseThermalUrlState(params: URLSearchParams): {
  ticker: string | null;
  lens: ThermalLens | null;
  compare: boolean;
} {
  return {
    ticker: parseThermalTicker(params.get("ticker")),
    lens: parseThermalLens(params.get("lens")),
    compare: params.get("compare") === "1" || params.get("compare") === "true",
  };
}

/** Build query string for the Thermal desk (preserves unrelated params). */
export function buildThermalUrlSearch(
  current: URLSearchParams,
  next: { ticker: string; lens: ThermalLens; compare: boolean }
): string {
  const p = new URLSearchParams(current.toString());
  p.set("ticker", next.ticker.toUpperCase());
  p.set("lens", next.lens);
  if (next.compare) p.set("compare", "1");
  else p.delete("compare");
  return p.toString();
}

function statusFromAge(
  ageMs: number | null,
  liveMs: number,
  staleMs: number
): ThermalFreshnessStatus {
  if (ageMs == null || !Number.isFinite(ageMs)) return "offline";
  if (ageMs < 0) return "syncing";
  if (ageMs <= liveMs) return "live";
  if (ageMs <= staleMs) return "stale";
  return "stale";
}

/**
 * Per-layer freshness from matrix/overlay/cross-val timestamps.
 * Never fabricates a live state when the sample is missing.
 */
export function thermalLayerFreshness(input: {
  nowMs: number;
  matrixAsof?: string | null;
  overlaysAt?: string | null;
  hasOverlays: boolean;
  crossValUwAsof?: string | null;
  crossValPresent: boolean;
  matrixLoading?: boolean;
}): ThermalLayerFreshness {
  const matrixMs = input.matrixAsof ? Date.parse(input.matrixAsof) : NaN;
  const matrixAge = Number.isFinite(matrixMs) ? input.nowMs - matrixMs : null;
  const matrixStatus: ThermalFreshnessStatus = input.matrixLoading
    ? "syncing"
    : statusFromAge(matrixAge, MATRIX_LIVE_MS, MATRIX_STALE_MS);

  let overlays: ThermalLayerFreshness["overlays"];
  if (!input.hasOverlays) {
    overlays = { status: "offline", asOf: null, label: "Overlays off" };
  } else if (!input.overlaysAt) {
    overlays = { status: "cached", asOf: null, label: "Overlays" };
  } else {
    const oMs = Date.parse(input.overlaysAt);
    const age = Number.isFinite(oMs) ? input.nowMs - oMs : null;
    overlays = {
      status: statusFromAge(age, OVERLAY_LIVE_MS, OVERLAY_STALE_MS),
      asOf: Number.isFinite(oMs) ? new Date(oMs) : null,
      label: "Overlays",
    };
  }

  let crossVal: ThermalLayerFreshness["crossVal"];
  if (!input.crossValPresent) {
    crossVal = { status: "offline", asOf: null, label: "UW check off" };
  } else if (!input.crossValUwAsof) {
    crossVal = { status: "cached", asOf: null, label: "UW check" };
  } else {
    const cMs = Date.parse(input.crossValUwAsof);
    crossVal = {
      status: "live",
      asOf: Number.isFinite(cMs) ? new Date(cMs) : null,
      label: "UW check",
    };
  }

  return {
    matrix: {
      status: matrixStatus,
      asOf: Number.isFinite(matrixMs) ? new Date(matrixMs) : null,
    },
    overlays,
    crossVal,
  };
}

/** Wall-scope chip copy — near-term only (matches server wall math). */
export function wallScopeLabel(nearTermExpiries: readonly string[] | null | undefined): {
  short: string;
  title: string;
} {
  const n = nearTermExpiries?.length ?? 0;
  if (n <= 0) {
    return {
      short: "Walls · near-term",
      title: "Call/put walls are computed from the near-term expiry set (not far monthly OpEx).",
    };
  }
  const sample = nearTermExpiries!.slice(0, 3).join(", ");
  const more = n > 3 ? ` +${n - 3} more` : "";
  return {
    short: `Walls · ${n} near-term`,
    title: `Call/put walls scoped to near-term expiries: ${sample}${more}. Far monthly/quarterly OpEx is excluded so walls stay consistent with γ flip.`,
  };
}

/** Honest empty copy for missing key levels — never invent a number. */
export function honestLevelEmpty(
  kind: "flip" | "cross_val" | "shift"
): { value: string; help: string } {
  if (kind === "flip") {
    return {
      value: "—",
      help: "Gamma flip undetermined — chain has not printed a clean dealer-gamma zero-crossing. Walls still show when available.",
    };
  }
  if (kind === "cross_val") {
    return {
      value: "—",
      help: "UW cross-check offline — live strike ladder unavailable (common after hours). Matrix walls are Polygon near-term only.",
    };
  }
  return {
    value: "—",
    help: "Intraday shift collecting — needs ≥2 matrix snapshots in session. Blank outside RTH by design.",
  };
}

/** True when a heatmap payload can paint a matrix (never treat empty as "good"). */
export function isUsableGexHeatmapPayload(data: {
  available?: boolean;
  spot?: unknown;
  strikes?: unknown;
  expiries?: unknown;
} | null | undefined): boolean {
  if (!data || data.available !== true) return false;
  // spot:0 emptyHeatmap is available:false at the route, but defend here too — a stale
  // client/session cache with spot 0 must never paint as a live matrix (live: SPY 0.00 blank).
  if (!(typeof data.spot === "number" && data.spot > 0)) return false;
  return Array.isArray(data.strikes) && data.strikes.length > 0
    && Array.isArray(data.expiries) && data.expiries.length > 0;
}

/**
 * Should the Thermal client request `?force=1` to refresh a stale matrix?
 * Pure — age vs force threshold, plus client throttle since last force.
 */
export function shouldForceMatrixRefresh(input: {
  asofMs: number | null;
  nowMs: number;
  lastForceAtMs: number;
  forceAgeMs?: number;
  forceThrottleMs?: number;
}): boolean {
  const { asofMs, nowMs, lastForceAtMs } = input;
  const forceAgeMs = input.forceAgeMs ?? MATRIX_FORCE_REFRESH_AGE_MS;
  const forceThrottleMs = input.forceThrottleMs ?? MATRIX_FORCE_THROTTLE_MS;
  if (asofMs == null || !Number.isFinite(asofMs)) return false;
  const age = nowMs - asofMs;
  if (!(age >= forceAgeMs)) return false;
  if (nowMs - lastForceAtMs < forceThrottleMs) return false;
  return true;
}
