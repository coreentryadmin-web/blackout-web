import type { GexWalls, GexWallLevel } from "@/lib/providers/gex-wall-levels";
import type { VectorWallLens, WallHistorySample } from "./vector-wall-history";

/**
 * Wall integrity / confidence — "is this wall real, or a thin level about to fold?"
 *
 * A member staring at beads can't tell a wall that has held all session and towers
 * over its neighbors from one that just appeared and sits in a mushy cluster. Both
 * render as a bead. This scores the difference from data the client already has —
 * no server plumbing — so it never over-trusts a thin wall.
 *
 * Three honest, independent factors (each normalized 0–1), blended:
 *  - STRENGTH (0.45): the wall's own net-gamma share (`pct`) — the raw size of the
 *    dealer gamma parked there. The dominant driver.
 *  - PERSISTENCE (0.35): the fraction of recent history-rail samples in which this
 *    strike showed up as a wall on its side. A level defended all session is far more
 *    trustworthy than one that blinked into existence this minute. Needs the rail;
 *    with no history it's neutral (0.5), never fabricated as "proven."
 *  - ISOLATION (0.20): how far the wall towers over the NEXT wall on its side
 *    ((this.pct − next.pct)/this.pct). A clean, isolated level is a real line; one
 *    inside a cluster of equals is diffuse. Single-wall side → fully isolated (1).
 *
 * Weights favor raw strength but let a persistent, dominant level earn "firm" and
 * knock a big-but-fleeting-and-clustered one down — which is the whole point.
 */

export type WallIntegrityTier = "firm" | "moderate" | "thin";

export type WallIntegrity = {
  strike: number;
  side: "call" | "put";
  /** 0–100 confidence. */
  score: number;
  tier: WallIntegrityTier;
  factors: { strength: number; persistence: number; isolation: number };
  /** Compact desk-terminal phrasing. */
  note: string;
};

const W_STRENGTH = 0.45;
const W_PERSISTENCE = 0.35;
const W_ISOLATION = 0.2;

/** Strikes within this distance are treated as the same level across rail samples. */
const STRIKE_MATCH_TOL = 1.0;
/**
 * How many trailing rail samples define "recent" for persistence.
 *
 * A COUNT, so the wall-clock span it covers depends on the recorder lane: oracle tickers record
 * every 5s (60 samples = ~5 minutes), non-oracle every 15s (~15 minutes), and an over-budget rail
 * compacted to 15s buckets is different again. That is the same trap `MAX_HISTORY` documents one
 * file over — "the same number means 'a full day' on one lane and '8 hours' on the other" — which
 * is why the note below reports the span it MEASURED rather than naming a fixed duration.
 */
const PERSISTENCE_WINDOW = 60;
/**
 * Fewer rail samples than this = no meaningful time series yet, so persistence is
 * "unknown" (neutral 0.5), NOT "proven." This matters off-hours for a ticker with no
 * recorded rail: seedWallHistoryForDisplay drops a SINGLE as-of-close sample, and a
 * one-sample rail made every wall read "held 100% of session" — an overclaim, since
 * nothing was actually observed holding over time. Below the floor we say "as-of-close."
 */
const MIN_RAIL_SAMPLES = 3;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function tierFor(score: number): WallIntegrityTier {
  return score >= 70 ? "firm" : score >= 45 ? "moderate" : "thin";
}

function persistenceFor(
  strike: number,
  side: "call" | "put",
  history: readonly WallHistorySample[]
): number {
  if (history.length < MIN_RAIL_SAMPLES) return 0.5; // seed/near-empty rail — unknown ≠ proven
  const recent = history.slice(-PERSISTENCE_WINDOW);
  let hits = 0;
  for (const sample of recent) {
    const levels = side === "call" ? sample.walls.callWalls : sample.walls.putWalls;
    if (levels.some((l) => Math.abs(l.strike - strike) <= STRIKE_MATCH_TOL)) hits += 1;
  }
  return recent.length ? hits / recent.length : 0.5;
}

/**
 * Score one wall against its same-side peers + the history rail.
 *
 * `refMaxPct` is the strongest wall's `pct` across BOTH sides — the normalizer for
 * the strength factor. This matters because `pct` is a wall's share of the WHOLE
 * chain's gamma (`|g| / totalAbsGamma`), so even the dominant wall is only a few
 * percent when gamma is spread across ~20 strikes. Dividing by a flat 100 made the
 * strength factor effectively dead (~0.05), so every wall collapsed to ~persistence
 * alone and a level that held all session still read "thin". Normalizing against the
 * strongest present wall gives the dominant level its due (strength → 1.0) while a
 * genuinely weak, clustered wall still scores low.
 */
export function scoreWallIntegrity(
  wall: GexWallLevel,
  side: "call" | "put",
  sideWalls: readonly GexWallLevel[],
  history: readonly WallHistorySample[],
  refMaxPct: number
): WallIntegrity | null {
  if (!wall || !(wall.strike > 0) || !(wall.pct >= 0)) return null;

  const strength = refMaxPct > 0 ? clamp01(wall.pct / refMaxPct) : 0;
  const persistence = persistenceFor(wall.strike, side, history);

  // Isolation: gap to the strongest OTHER wall on this side.
  const others = sideWalls.filter((l) => Math.abs(l.strike - wall.strike) > STRIKE_MATCH_TOL);
  const nextPct = others.length ? Math.max(...others.map((l) => l.pct)) : 0;
  const isolation = wall.pct > 0 ? clamp01((wall.pct - nextPct) / wall.pct) : 0;

  const score = Math.round(
    100 * (W_STRENGTH * strength + W_PERSISTENCE * persistence + W_ISOLATION * isolation)
  );
  const tier = tierFor(score);

  return {
    strike: wall.strike,
    side,
    score,
    tier,
    factors: {
      strength: round2(strength),
      persistence: round2(persistence),
      isolation: round2(isolation),
    },
    note: buildNote(side, wall.strike, tier, persistence, isolation, history),
  };
}

/**
 * Strength normalizer = the strongest wall's share across BOTH sides, so the dominant level
 * anchors strength at 1.0 and no wall's score is crushed by the fact that any single strike is
 * only a few % of the whole chain's gamma. Shared by every scorer so the "firm/moderate/thin"
 * verdict is identical whether it's read on the desk terminal (top wall) or on a bead ring
 * (every wall) — one source of truth, no drift between surfaces.
 */
function refMaxPctOf(walls: GexWalls | null | undefined): number {
  return Math.max(
    0,
    ...(walls?.callWalls ?? []).map((w) => w.pct),
    ...(walls?.putWalls ?? []).map((w) => w.pct)
  );
}

/** Integrity of the top call + top put wall — the two levels the desk reads first. */
export function scoreTopWalls(
  walls: GexWalls | null | undefined,
  history: readonly WallHistorySample[] = []
): { call: WallIntegrity | null; put: WallIntegrity | null } {
  const refMaxPct = refMaxPctOf(walls);
  const call = walls?.callWalls?.length
    ? scoreWallIntegrity(walls.callWalls[0]!, "call", walls.callWalls, history, refMaxPct)
    : null;
  const put = walls?.putWalls?.length
    ? scoreWallIntegrity(walls.putWalls[0]!, "put", walls.putWalls, history, refMaxPct)
    : null;
  return { call, put };
}

/**
 * Score EVERY wall on each side, keyed by strike — the per-wall integrity the chart's bead rings
 * consume so each drawn wall (not just the top one) carries its firm/moderate/thin confidence as a
 * second visual channel. Uses the exact same {@link scoreWallIntegrity} math and shared `refMaxPct`
 * as {@link scoreTopWalls}, so a bead ring and the desk terminal can never disagree about a wall.
 *
 * Keyed by the raw ladder strike (the recorder stores strikes verbatim, so a bead trail's `strike`
 * matches a scored wall's `strike` exactly — no tolerance needed at lookup). A null/empty side maps
 * to an empty Map, never a fabricated entry.
 */
export function integrityByStrike(
  walls: GexWalls | null | undefined,
  history: readonly WallHistorySample[] = []
): { call: Map<number, WallIntegrity>; put: Map<number, WallIntegrity> } {
  const refMaxPct = refMaxPctOf(walls);
  const scoreSide = (
    sideWalls: readonly GexWallLevel[] | undefined,
    side: "call" | "put"
  ): Map<number, WallIntegrity> => {
    const map = new Map<number, WallIntegrity>();
    for (const wall of sideWalls ?? []) {
      const scored = scoreWallIntegrity(wall, side, sideWalls ?? [], history, refMaxPct);
      if (scored) map.set(wall.strike, scored);
    }
    return map;
  };
  return {
    call: scoreSide(walls?.callWalls, "call"),
    put: scoreSide(walls?.putWalls, "put"),
  };
}

/** Per-strike firm/moderate/thin tiers for bead-ring rendering (GEX lens only). */
export function beadIntegrityTierMaps(
  history: readonly WallHistorySample[],
  lens: VectorWallLens = "gex"
): { call: Map<number, WallIntegrityTier>; put: Map<number, WallIntegrityTier> } | null {
  if (lens !== "gex") return null;
  const latestWalls = history[history.length - 1]?.walls;
  if (!latestWalls) return null;
  const scored = integrityByStrike(latestWalls, history);
  const call = new Map<number, WallIntegrityTier>();
  const put = new Map<number, WallIntegrityTier>();
  for (const [strike, wi] of scored.call) call.set(strike, wi.tier);
  for (const [strike, wi] of scored.put) put.set(strike, wi.tier);
  return { call, put };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Wall-clock span the persistence window actually covered, as a short human label ("5m", "1h20m").
 *
 * Derived from the sample TIMESTAMPS rather than named as a constant, because 60 samples is a
 * different duration on every lane: ~5 minutes at the oracle recorder's 5s cadence, ~15 minutes at
 * the non-oracle 15s cadence, and longer again on a rail whose old end has been compacted to 15s
 * buckets. `time` is epoch-SECONDS (see WallHistorySample).
 */
function windowSpanLabel(history: readonly WallHistorySample[]): string | null {
  const recent = history.slice(-PERSISTENCE_WINDOW);
  const first = recent[0]?.time;
  const last = recent[recent.length - 1]?.time;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const sec = Math.round(last! - first!);
  if (!(sec > 0)) return null;
  if (sec < 90) return `${sec}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/**
 * The note a member reads under a wall, e.g. "7500C firm — held 100% of last 5m, dominant".
 *
 * It used to end "held N% of session", and that was an overclaim of exactly the kind this file
 * already knew to avoid — see MIN_RAIL_SAMPLES, which exists because a ONE-sample rail reading
 * "held 100% of session" claimed an observation nobody had made. The 60-sample case said the same
 * wrong thing: persistence is measured over PERSISTENCE_WINDOW trailing samples, which on an oracle
 * ticker is about five minutes out of a 390-minute session. A wall that first appeared four minutes
 * ago read "held 100% of session".
 *
 * So the note now states the window it measured. That keeps the claim exactly as strong as the
 * evidence behind it, on every recorder lane, without changing the score — the SCORING window is a
 * separate question (35% of the integrity score rides on this factor) and is deliberately left
 * alone here rather than quietly retuned inside a labelling fix.
 */
function buildNote(
  side: "call" | "put",
  strike: number,
  tier: WallIntegrityTier,
  persistence: number,
  isolation: number,
  history: readonly WallHistorySample[]
): string {
  const span = windowSpanLabel(history);
  const held =
    history.length === 0
      ? "no rail yet"
      : history.length < MIN_RAIL_SAMPLES
        ? "as-of-close" // seed/near-empty rail — no observation over time to claim at all
        : `held ${Math.round(persistence * 100)}%${span ? ` of last ${span}` : " of observed rail"}`;
  const shape = isolation >= 0.5 ? "dominant" : "clustered";
  return `${Math.round(strike)}${side === "call" ? "C" : "P"} ${tier} — ${held}, ${shape}`;
}
