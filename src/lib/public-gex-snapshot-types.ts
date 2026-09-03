/** Client-safe types/constants for the public GEX snapshot lead magnet. */

import { etSessionFacts } from "@/lib/et-session-facts";
import { type MarketPhase } from "@/lib/largo/core/system-status";

export type { MarketPhase };

export type PublicWallRole = "support" | "resistance" | "concentration";

export type PublicGexSnapshot = {
  available: boolean;
  ticker: string;
  spot: number | null;
  change_pct: number | null;
  asof: string | null;
  call_wall: number | null;
  put_wall: number | null;
  flip: number | null;
  posture: "long" | "short" | null;
  /** What each wall can honestly be called given spot — see classifyWall. Null when unknowable. */
  call_wall_role: PublicWallRole | null;
  put_wall_role: PublicWallRole | null;
  read: string;
  /** Origin of the spot price: ws=live WebSocket, redis_cluster=cross-replica fallback, rest=Polygon REST, prev_bar=prior session, synthetic=UW fallback (omitted when unavailable). */
  spot_source?: "ws" | "redis_cluster" | "rest" | "prev_bar" | "synthetic";
  /** True when the options chain was truncated by pagination guards, signaling strikes may exist beyond the fetched range. Omitted when the full chain was retrieved. */
  chain_truncated?: boolean;
  /**
   * WHEN, as three separate facts — because `asof` alone was being read as a fourth thing it is not.
   *
   * `asof` is the moment the MATRIX was computed. On a closed market the builder still recomputes
   * every few seconds over an unchanged book, so `asof` is honestly "just now" while the price it
   * models is the last session's close. The widget rendered exactly that: "Updated just now" beside
   * a spot that had not moved since Friday's bell.
   *
   * MEASURED 2026-08-22 23:15Z (Saturday, 19:15 ET) on production: public `spot` for SPX (7674.37)
   * and SPY (765.72) matched Polygon's 2026-08-21 close to the cent, with `asof` under 20 seconds
   * old and no session label anywhere on the page. This is the one Thermal surface no member
   * context gates, so a wrong freshness claim here is a credibility problem for the whole product.
   *
   * `get_thermal_compare` already solved this for its own payload after measuring the same failure
   * ("a matrix rebuilt 300 seconds ago can be modelling a close that settled hours earlier"); these
   * three fields are the same disclosure for the public surface.
   */
  market_session: MarketPhase | null;
  /** ET session date (YYYY-MM-DD) this payload was generated in. Never derive a session from UTC. */
  session_date: string | null;
  /** The matrix compute time as an ET wall-clock stamp, beside the raw UTC `asof`. */
  as_of_et: string | null;
  /** Seconds since `asof` at response time — lets clients and monitors reason about freshness without parsing ISO timestamps. */
  snapshot_data_age_seconds?: number | null;
  /** Why the snapshot is unavailable when `available` is false — `warming` (no data yet), `error` (build threw), or omitted when live. */
  warming_reason?: "warming" | "error" | null;
  /** True when serving a cached last-good read because the live upstream missed this refresh. */
  degraded?: boolean;
  /** Human-readable note for degraded payloads — shown in the UI badge. */
  degraded_note?: string | null;
  /**
   * Cross-product compute identity, passed through verbatim from the underlying `GexHeatmap` /
   * `GexPositioning` (same matrix build — see those types' own comments). A `calculation_id`
   * matching what SPX Slayer, Vector, or Thermal are reading for the same ticker means this free
   * snapshot and that paid surface are reasoning from the literally identical positioning state.
   * Omitted on a degraded/last-known-good or warming-placeholder read (nothing was computed).
   */
  calculation_id?: string;
  calculated_at?: string;
  spot_timestamp?: string;
  chain_timestamp?: string;
  expires_at?: string;
};

const ALLOWED_TICKERS = ["SPX", "SPY", "QQQ"] as const;
export type PublicGexTicker = (typeof ALLOWED_TICKERS)[number];

export function isPublicGexTicker(value: string): value is PublicGexTicker {
  return (ALLOWED_TICKERS as readonly string[]).includes(value);
}

export function publicGexTickers(): readonly PublicGexTicker[] {
  return ALLOWED_TICKERS;
}

/** Strip vendor/infra provenance before the read string leaves the server. */
export function sanitizePublicRead(read: string): string {
  return read
    .replace(/\s*\([^()]*\b(?:UW|Unusual\s*Whales|Polygon|Massive)\b[^()]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Which claim a wall can honestly support, given where price actually is.
 *
 * `computeGexWalls` splits strikes by the SIGN of net dealer gamma and takes no spot argument, so
 * "put wall" means "most negative dealer gamma" — which can legitimately land ABOVE spot (live
 * 2026-08-12: SPX spot 7748.5, put wall 8000, most likely an 8/21 OpEx line). The NUMBER is right.
 * Calling it "support" is what's wrong: a reader on a chart at 7748 is told their support sits 250
 * points overhead, which is incoherent as a level and the one reading a trader must never be handed.
 *
 * Same defect and same remedy as the Thermal Key Levels tile (#2115) — fix the LABEL, never the
 * wall definition, so the ~150 consumers of `computeGexWalls` keep the exact numbers they have.
 * Applied symmetrically: a call wall BELOW spot is equally incoherent as "resistance".
 */
export function classifyWall(
  kind: "call" | "put",
  wall: number | null,
  spot: number | null
): PublicWallRole | null {
  // Degrade to no claim rather than guessing a side — a null or zero spot cannot order anything.
  if (wall == null || spot == null || !Number.isFinite(wall) || !Number.isFinite(spot) || spot <= 0) {
    return null;
  }
  if (kind === "call") return wall > spot ? "resistance" : "concentration";
  return wall < spot ? "support" : "concentration";
}

/**
 * Rewrite the regime narration's trailing "Resistance X, support Y." clause so it never asserts a
 * level that sits on the wrong side of price.
 *
 * Targeted at the clause rather than the whole sentence: everything before it (spot vs flip, the
 * long/short-gamma explanation) is already true and is what makes the snapshot useful. Only the
 * directional claim can be false. A wall on the wrong side is dropped rather than relabelled inline,
 * because "resistance 7800, concentration 8000" would read as a level too — the tile carries the
 * honest wording, and the prose simply stops asserting what it cannot support.
 *
 * If the producer's wording changes and the clause no longer matches, the read passes through
 * untouched: this can only ever remove a false claim, never invent one.
 */
export function correctPublicRead(
  read: string,
  levels: { spot: number | null; call_wall: number | null; put_wall: number | null }
): string {
  const clause = /\s*Resistance\s+[\d,.]+\s*,\s*support\s+[\d,.]+\s*\./i;
  if (!clause.test(read)) return read;

  const callRole = classifyWall("call", levels.call_wall, levels.spot);
  const putRole = classifyWall("put", levels.put_wall, levels.spot);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const parts: string[] = [];
  if (callRole === "resistance" && levels.call_wall != null) parts.push(`Resistance ${fmt(levels.call_wall)}`);
  if (putRole === "support" && levels.put_wall != null) parts.push(`support ${fmt(levels.put_wall)}`);

  const replacement = parts.length
    ? ` ${parts.join(", ")}.`
    : // Both walls sit on the wrong side: say so plainly rather than leaving a bare sentence, so the
      // absence reads as a deliberate statement about the book and not as missing data.
      " Both gamma walls currently sit on the far side of spot, so neither is acting as a level.";

  return read.replace(clause, replacement).replace(/\s{2,}/g, " ").trim();
}

/**
 * Suppress the ACTIONABLE momentum claim in the regime narration outside RTH.
 *
 * `correctPublicRead` above fixes the wall-side clause; this fixes a different defect in the same
 * string. The narration's directional language ("momentum / vol expansion, moves accelerate" /
 * "range-bound, fade extremes") is a live trading read — it tells a visitor what dealer hedging is
 * doing to price RIGHT NOW. `publicFreshnessCopy` already knows, from `market_session` alone
 * (independent of `asof`), when the underlying quote is NOT live: pre-market, after-hours, or
 * closed. But nothing connected that fact to this string — `computeGexRegimeCore` (the shared
 * builder every desk surface reads, including live-member Thermal/Vector) has no concept of quote
 * freshness at all, and correctly so: for a member trading RTH, spot IS live and the actionable
 * read is exactly right. The public snapshot is the one place composing this string for a
 * non-authenticated visitor with no session gate, so it is the one place that must ALSO check
 * `market_session` before repeating the actionable framing — the fix belongs here, not in the
 * shared regime builder, so live member reads are untouched.
 *
 * Measured: pre-market/after-hours/closed still called `buildSnapshotFromHeatmap` every 5s and
 * published "dealers are net short gamma at EVERY strike ... momentum / vol expansion, moves
 * accelerate" beside a spot explicitly marked stale by `priceNote` — a fresh RECOMPUTE timestamp
 * making a stale INPUT look actionable.
 */
export function applyPublicReadFreshnessGate(read: string, marketSession: MarketPhase | null): string {
  if (marketSession === "OPEN") return read;
  const structural = read
    .replace(
      /→\s*short gamma:\s*momentum \/ vol expansion, moves accelerate/i,
      "→ short gamma structurally (not a live actionable read)"
    )
    .replace(
      /→\s*long gamma:\s*range-bound, fade extremes/i,
      "→ long gamma structurally (not a live actionable read)"
    );
  return `Prior-session structural reference — ${structural}`;
}


/**
 * ET session facts for a public snapshot, from ONE instant.
 *
 * Delegates to the shared `etSessionFacts` so the public page, `get_positioning` and
 * `get_gex_heatmap` cannot disagree about the same minute.
 *
 * HOLIDAYS ARE NOW MODELLED. This originally composed `marketPhaseFromEt` directly and documented
 * the gap honestly — that helper carries no holiday calendar, so Thanksgiving read as a normal
 * session. That was written as a bounded inaccuracy rather than an invented calendar, which was the
 * right call at the time but the wrong conclusion: the repo already HAS a holiday-aware trading-day
 * gate (`isTradingDayEt`, which `isEtCashRth` uses), so the platform could tell the market was shut
 * while this page could not. The shared helper composes the two.
 */
export function publicSnapshotSessionFacts(now: Date = new Date()): {
  market_session: MarketPhase;
  session_date: string;
  as_of_et: string;
} {
  const { market_session, session_date, as_of_et } = etSessionFacts(now);
  return { market_session, session_date, as_of_et };
}

/**
 * The honest freshness line for the public widget.
 *
 * Two claims, deliberately kept apart, because collapsing them is the whole defect: how old the
 * LEVELS are (a real property of `asof`) and whether the PRICE is live (a property of the market
 * session). "Updated just now" answered the first and was read as the second.
 *
 * Returns `null` for `priceNote` only when the market is OPEN — the one case where the spot really
 * is a live quote and no caveat is owed.
 */
export function publicFreshnessCopy(input: {
  asof: string | null;
  market_session: MarketPhase | null;
  now?: number;
}): { levels: string; priceNote: string | null } {
  const now = input.now ?? Date.now();
  const t = input.asof ? Date.parse(input.asof) : NaN;
  const ms = Number.isFinite(t) ? now - t : NaN;

  let levels: string;
  if (!Number.isFinite(ms) || ms < 0) {
    levels = "Levels — timing unavailable";
  } else {
    const mins = Math.round(ms / 60_000);
    const age = mins < 1 ? "just now" : mins === 1 ? "1 min ago" : `${mins} min ago`;
    levels = `Levels computed ${age}`;
  }

  // An unknown session must not silently render as OPEN — absence is not a green light.
  if (input.market_session == null) return { levels, priceNote: "Market session unknown" };
  if (input.market_session === "OPEN") return { levels, priceNote: null };
  if (input.market_session === "PRE-MARKET") {
    return { levels, priceNote: "Pre-market — price is the prior session's close or an early print, not a live quote" };
  }
  if (input.market_session === "AFTER-HOURS") {
    return { levels, priceNote: "After hours — price is the closing print or a late trade, not a live quote" };
  }
  return { levels, priceNote: "Market closed — price is the last session's close, not a live quote" };
}

/** Alert ops when the public lead magnet has no data beyond this window. */
export const PUBLIC_GEX_WARMING_ALARM_SEC = 300;

/** Pure helper — unit-tested; drives prolonged-warmup paging without Redis. */
export function shouldAlarmPublicGexWarming(
  warmingSinceMs: number | null,
  nowMs: number,
  thresholdSec = PUBLIC_GEX_WARMING_ALARM_SEC
): boolean {
  if (warmingSinceMs == null || !Number.isFinite(warmingSinceMs)) return false;
  return nowMs - warmingSinceMs >= thresholdSec * 1000;
}
