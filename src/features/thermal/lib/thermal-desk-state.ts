/**
 * Pure Thermal desk helpers — URL state, per-layer freshness, compare universe.
 * Kept out of GexHeatmap.tsx so unit tests don't need the 4k-line React surface.
 */

import {
  type ThermalComparePresetId,
  parseThermalComparePresetId,
  THERMAL_COMPARE_TICKERS,
} from "./thermal-compare-presets";

export { THERMAL_COMPARE_TICKERS };
export type ThermalCompareTicker = (typeof THERMAL_COMPARE_TICKERS)[number];

export type ThermalLens = "gex" | "vex" | "dex" | "charm";

const LENSES: readonly ThermalLens[] = ["gex", "vex", "dex", "charm"];

/** Matrix is live under ~2.5× the 5s poll; amber after that. */
export const MATRIX_LIVE_MS = 12_000;
export const MATRIX_STALE_MS = 15_000;
/**
 * When matrix `asof` is older than this during a live Thermal view, request `?force=1`
 * (server-throttled ≤1/5s) — same escape hatch SPX Slayer uses so SPY/QQQ don't sit on
 * the 1-minute heatmap-warm EventBridge floor while the client polls every 5s.
 */
export const MATRIX_FORCE_REFRESH_AGE_MS = 5_000;
/** Client-side spacing between force attempts (matches server FORCE_THROTTLE_MS). */
export const MATRIX_FORCE_THROTTLE_MS = 5_000;

/** Indices desk names where a lone blank column may still request ?force=1. */
export const THERMAL_MATRIX_CORE_TICKERS = ["SPY", "SPX", "QQQ", "IWM"] as const;

/**
 * May a blank column auto-escalate to ?force=1?
 *
 * Sector compare grids open 3–7 tickers at once. Forcing every blank column fans out parallel
 * cold Polygon rebuilds (~55s each) and wedges the whole desk in "Syncing …" — even when Redis
 * already holds a warm matrix for the normal (non-force) read path.
 */
export function shouldForceBlankMatrixRefresh(
  ticker: string,
  opts: { activeColumn?: boolean } = {}
): boolean {
  const t = ticker.trim().toUpperCase();
  if (!(THERMAL_MATRIX_CORE_TICKERS as readonly string[]).includes(t)) return false;
  return opts.activeColumn === true;
}
/** Overlay cache is ~30s — treat as live under 45s. */
export const OVERLAY_LIVE_MS = 45_000;
export const OVERLAY_STALE_MS = 90_000;

export type ThermalFreshnessStatus = "live" | "stale" | "cached" | "offline" | "syncing";

export type ThermalLayerFreshness = {
  matrix: { status: ThermalFreshnessStatus; asOf: Date | null };
  overlays: { status: ThermalFreshnessStatus; asOf: Date | null; label: string };
  crossVal: {
    status: ThermalFreshnessStatus;
    asOf: Date | null;
    label: string;
    /** Hover copy — the chip label alone cannot explain what a cross-check is. */
    title: string;
  };
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
  compareSet: ThermalComparePresetId | null;
} {
  return {
    ticker: parseThermalTicker(params.get("ticker")),
    lens: parseThermalLens(params.get("lens")),
    compare: params.get("compare") === "1" || params.get("compare") === "true",
    compareSet: parseThermalComparePresetId(params.get("compareSet")),
  };
}

/** Build query string for the Thermal desk (preserves unrelated params). */
export function buildThermalUrlSearch(
  current: URLSearchParams,
  next: {
    ticker: string;
    lens: ThermalLens;
    compare: boolean;
    compareSet?: ThermalComparePresetId | null;
  }
): string {
  const p = new URLSearchParams(current.toString());
  p.set("ticker", next.ticker.toUpperCase());
  p.set("lens", next.lens);
  if (next.compare) p.set("compare", "1");
  else p.delete("compare");
  if (next.compare && next.compareSet) p.set("compareSet", next.compareSet);
  else p.delete("compareSet");
  return p.toString();
}

export type { ThermalComparePresetId };

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

const CROSS_CHECK_TITLE =
  "A second, independent options-data source is confirming the strike ladder these walls are drawn from.";
const CROSS_CHECK_OFF_TITLE =
  "The second data source is unavailable right now (common outside market hours), so the walls come from a single source. They are still real — just unconfirmed.";

/**
 * Per-layer freshness from matrix/overlay/cross-val timestamps.
 * Never fabricates a live state when the sample is missing.
 */
/**
 * What the matrix-panel status badge is allowed to claim.
 *
 * THE BUG THIS REPLACES. The badge read `live = !error && data.available && hasStrikes && !stale`
 * and rendered a green pulsing **"Quote live"**. None of those four terms is about liveness:
 * `stale` there is the TICKER-SWITCH guard ("the matrix in hand belongs to a different underlying
 * than the one selected"), not an age check. So the pill meant "we have an options chain for this
 * ticker" while SAYING "this price is live".
 *
 * Measured live 2026-08-21 at 20:41 ET — four and a half hours after the cash close — `/heatmap`
 * showed `SPY 762.60` under a green pulsing "Quote live". 762.60 is EXACTLY SPY's 16:00 ET close
 * (confirmed against Polygon's prior-session bar). The badge was asserting a live quote over a
 * settled close, which is the one thing a freshness pill exists to prevent.
 *
 * So liveness now requires the cash session to actually be open. `isEtCashRth` is the canonical
 * gate (holiday- and early-close-aware, and documented safe on both server and client) — this
 * helper takes the answer as an input rather than calling it, to stay pure and testable.
 *
 * `marketOpen: null` means NOT YET KNOWN (pre-hydration — the caller resolves the clock in an
 * effect to avoid an SSR/client mismatch, the same way ThermalFreshnessBar does). Unknown must
 * never render as live: claiming live and correcting it a tick later is the failure we are fixing.
 */
/**
 * The compare strip's cadence/liveness label.
 *
 * Same defect as the matrix panel badge, on a second component: the strip rendered a hardcoded
 * `Live matrix · 5s` with no condition on anything. It could never be right or wrong from data —
 * it simply always claimed live, including at 20:41 ET over a settled 16:00 close. (The payload
 * type even declares `asof`, and the component never reads it.)
 *
 * The CADENCE half is a real fact and is kept: the strip does poll every 5s in and out of session
 * (`usePollIntervalMs(5_000, 5_000)`). Only the LIVENESS half is conditional.
 *
 * `marketOpen: null` means not yet known (pre-hydration) and must not render as live — see
 * thermalQuoteBadge for why.
 */
export function thermalCompareStripLabel(input: {
  marketOpen: boolean | null;
  pollSeconds: number;
}): string {
  const cadence = `${Math.max(1, Math.round(input.pollSeconds))}s`;
  return input.marketOpen === true
    ? `Live matrix · ${cadence}`
    : `Matrix · ${cadence} · market closed`;
}

export type ThermalQuoteBadgeState = "live" | "market-closed" | "quote-only" | "offline";

export function thermalQuoteBadge(input: {
  /** A usable, current-ticker chain with strikes is in hand. */
  hasChain: boolean;
  /** Spot resolved but the chain came back empty. */
  quoteOnly: boolean;
  /** Cash RTH open, or null when the clock has not been resolved client-side yet. */
  marketOpen: boolean | null;
}): { state: ThermalQuoteBadgeState; label: string; tone: "bull" | "sky"; dot: boolean; title: string } {
  if (input.hasChain) {
    if (input.marketOpen === true) {
      return {
        state: "live",
        label: "Quote live",
        tone: "bull",
        dot: true,
        title: "Cash session is open — spot is a live quote.",
      };
    }
    // Covers both "not yet known" and "cash session closed". Pre-market and after-hours both land
    // here on purpose: there may be extended-hours prints, but the number is not a live CASH
    // quote, and dealer gamma is a cash-session construct.
    return {
      state: "market-closed",
      label: "Market closed",
      tone: "sky",
      dot: false,
      title:
        "Cash session is closed — spot is the last print, not a live quote. The matrix is still " +
        "computed from the current options chain.",
    };
  }
  if (input.quoteOnly) {
    return {
      state: "quote-only",
      label: "Quote only",
      tone: "sky",
      dot: false,
      title: "Spot resolved but the options chain is empty — no dealer gamma to show.",
    };
  }
  return {
    state: "offline",
    label: "Offline",
    tone: "sky",
    dot: false,
    title: "No matrix available for this ticker right now.",
  };
}

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

  // "UW" is our upstream vendor's initials, not a word a member has any reason to know. The chip
  // said "UW check off" — three tokens, none of which explain that a SECOND, independent strike
  // ladder is (or is not) confirming the walls the matrix is drawing. Name the job, not the vendor.
  let crossVal: ThermalLayerFreshness["crossVal"];
  if (!input.crossValPresent) {
    crossVal = {
      status: "offline",
      asOf: null,
      label: "Cross-check off",
      title: CROSS_CHECK_OFF_TITLE,
    };
  } else if (!input.crossValUwAsof) {
    crossVal = { status: "cached", asOf: null, label: "Cross-check", title: CROSS_CHECK_TITLE };
  } else {
    const cMs = Date.parse(input.crossValUwAsof);
    crossVal = {
      status: "live",
      asOf: Number.isFinite(cMs) ? new Date(cMs) : null,
      label: "Cross-check",
      title: CROSS_CHECK_TITLE,
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

/**
 * What the key-levels row is actually scoped to, when the member has picked ONE expiry.
 * `nearSpotGammaShare` is that expiry's 0-1 share of the near-spot dealer gamma (the pin contest).
 */
export type KeyLevelsScope = {
  expiryLabel: string;
  nearSpotGammaShare?: number | null;
};

/**
 * Key-levels bar kicker — discloses the row's scope so members don't compare to all-expiry tools.
 *
 * Two different scopes, and the copy has to tell them apart: a HORIZON preset still blends the
 * near-term expiry set, but a single-expiry pick does not, and calling that "near-term" would be
 * the exact mixed-scope claim this panel was rebuilt to stop making. When one expiry is scoped we
 * also print its share of the near-spot gamma — the number that says whether dealers are still
 * defending THIS expiry or have already rolled to the next one.
 */
export function keyLevelsKicker(
  lensUpper: string,
  nearTermExpiries: readonly string[] | null | undefined,
  scope?: KeyLevelsScope | null
): string {
  if (scope?.expiryLabel) {
    const share = scope.nearSpotGammaShare;
    const pct =
      typeof share === "number" && Number.isFinite(share) && share > 0
        ? ` · ${Math.round(share * 100)}% of near-spot γ`
        : "";
    return `${lensUpper} · ${scope.expiryLabel}${pct}`;
  }
  const n = nearTermExpiries?.length ?? 0;
  return n > 0 ? `${lensUpper} · near-term (${n})` : `${lensUpper} · near-term`;
}

/**
 * Footnote under the key-levels box — explains why matrix cell peaks can disagree with the bar.
 * `frontExpiryLabel` is optional human text for max-pain scope (e.g. "Aug 4").
 * `scopedExpiryLabel` is set when the row is scoped to ONE expiry, which changes what is true:
 * flip/walls/net GEX are then that expiry alone. King node follows the same scope as the
 * profile anchor and the matrix Net column when an expiry filter is active.
 */
/**
 * The footnote with the part the KICKER already says removed.
 *
 * When a single expiry is scoped, the kicker above the row already reads "GEX · Aug 14 · …",
 * so restating flip/walls/net/max pain scope is redundant. King node now follows the same
 * expiry scope as the key-levels row — only the matrix peak-cell note remains in compact mode.
 *
 * Unscoped is returned verbatim: with no expiry in the kicker, nothing else discloses that the
 * tiles sum near-term expiries or that max pain is a single expiry's OI.
 */
export function keyLevelsFootnoteCompact(
  frontExpiryLabel?: string | null,
  scopedExpiryLabel?: string | null
): string {
  if (scopedExpiryLabel?.trim()) {
    return `Matrix gold/purple cell peaks can land on any expiry column.`;
  }
  return keyLevelsFootnote(frontExpiryLabel, scopedExpiryLabel);
}

export function keyLevelsFootnote(
  frontExpiryLabel?: string | null,
  scopedExpiryLabel?: string | null
): string {
  const scoped = scopedExpiryLabel?.trim();
  if (scoped) {
    return (
      `Flip, walls, net GEX, max pain, and King node are ${scoped} only. ` +
      `Matrix gold/purple cell peaks can land on any expiry column.`
    );
  }
  const mp = frontExpiryLabel?.trim()
    ? `Max pain is ${frontExpiryLabel.trim()} OI only.`
    : "Max pain is front/nearest expiry OI only.";
  return (
    `Flip, walls, net GEX, and King node sum near-term expiries — far monthly OpEx is excluded. ` +
    `Matrix gold/purple cell peaks can land on any expiry column. ${mp}`
  );
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
      help: "Cross-check offline — the second data source's live strike ladder is unavailable (common after hours). Walls come from the primary source's near-term expiries only.",
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
 * RTH-only — off-hours reads warm Redis / heatmap-warm cron; never force-rebuild chains.
 */
export function shouldForceMatrixRefresh(input: {
  asofMs: number | null;
  nowMs: number;
  lastForceAtMs: number;
  forceAgeMs?: number;
  forceThrottleMs?: number;
  /** When false (off-hours / closed), never force — normal poll + cron warm only. */
  sessionLive?: boolean;
}): boolean {
  const sessionLive = input.sessionLive ?? true;
  if (!sessionLive) return false;

  const { asofMs, nowMs, lastForceAtMs } = input;
  const forceAgeMs = input.forceAgeMs ?? MATRIX_FORCE_REFRESH_AGE_MS;
  const forceThrottleMs = input.forceThrottleMs ?? MATRIX_FORCE_THROTTLE_MS;
  if (asofMs == null || !Number.isFinite(asofMs)) return false;
  const age = nowMs - asofMs;
  if (!(age >= forceAgeMs)) return false;
  if (nowMs - lastForceAtMs < forceThrottleMs) return false;
  return true;
}

/**
 * Tooltip for the matrix "Net flow" column header.
 *
 * When `usesNearTermFallback` is true the member narrowed scope but the rail is still the
 * near-term aggregate — disclose that beside scoped King/DR%. When scoped depth IS available,
 * say so plainly instead of implying a mismatch.
 */
export function netFlowHeaderTooltip(args?: {
  scopeLabel?: string | null;
  usesNearTermFallback?: boolean;
}): string {
  const base =
    "Forced dealer hedging flow if price reaches that strike — buying grows left, selling right. " +
    "Conditional flow, not resting liquidity.";
  const label = args?.scopeLabel?.trim();
  if (!label) return base;
  if (args?.usesNearTermFallback) {
    return (
      `${base} Same near-term book as the Depth tab — NOT re-scoped to ${label}, ` +
      `unlike the King node and DR% columns.`
    );
  }
  return `${base} Repriced for ${label} contracts only (matches King node and DR% scope).`;
}
