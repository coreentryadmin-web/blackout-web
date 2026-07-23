/**
 * ALLOCATION ENGINE (v0) — the missing stage between Decision and Execution.
 *
 * The scoring/gate stack answers "is THIS setup good?" independently, per symbol. But traders don't buy
 * scores — they allocate scarce capital to the BEST opportunities available right now, and they don't want
 * four versions of the same bet. This layer answers the portfolio questions the per-symbol engine can't:
 *   1. Cross-sectional rank — of everything that cleared the floor, what's actually the best today?
 *   2. Duplicate thesis     — NVDA/AMD/SMCI all bullish is ONE semis thesis, not three edges.
 *   3. Opportunity cost      — given what's already covered, does this add real, diversifying exposure?
 *   4. Concentration         — how much of one theme/sector should the book carry?
 *
 * CALIBRATION-FIRST / ADVISORY: this ranks + flags redundancy and emits a suggested size; it does NOT gate
 * the engine or size real risk yet. It graduates on a PORTFOLIO backtest that replays the decision sequence
 * (see note below) before it's allowed to reject a trade for real.
 *
 * RANK on `ev ?? score`: ranking by score is honest today; ranking by calibrated Expected Value (R units)
 * needs P(win) from the feature store, which accrues over sessions. The `ev` field is the graduation hook —
 * null today, real once the store can price it. No fabricated EV.
 *
 * PATH-DEPENDENCE WARNING (for whoever backtests this): the moment we reject B because we took A, setups are
 * no longer independent. A portfolio backtest MUST replay allocate() over each session's ranked set and grade
 * the SURVIVING book — grading every candidate in isolation would silently overstate this engine's value.
 *
 * PURE & deterministic — no IO. Sector taxonomy + any correlation input are injected by the caller.
 */

export type Direction = "LONG" | "SHORT";
export type Sizing = "FULL" | "HALF" | "SKIP";
export type ClusterRole = "PRIMARY" | "REDUNDANT";

export interface AllocationCandidate {
  ticker: string;
  direction: Direction;
  /** 0–100 committed evidence score. */
  score: number;
  /** Calibrated expected value in R (risk multiples), when the feature store can price it. Ranks over
   *  `score` when finite; null/absent → rank on score (honest until the store matures). */
  ev?: number | null;
  /** Sector / theme label (GICS-ish). Null = unknown → the name is its OWN thesis, never merged blindly. */
  sector?: string | null;
}

/** A position the book already holds — seeds cluster/sector counts so new adds are judged against it. */
export interface ExistingExposure {
  ticker: string;
  direction: Direction;
  sector?: string | null;
}

export interface AllocationConfig {
  /** Cross-sectional cut: only the best N compete for capital; the rest are SKIP ("outside top N"). */
  topN: number;
  /** Max names sharing one (sector,direction) thesis — the duplicate-thesis cap. */
  maxPerCluster: number;
  /** Max names in one sector regardless of direction — the concentration cap. */
  maxPerSector: number;
  /** Survivors whose rank percentile is at/below this get HALF size (weaker end of the book). */
  halfSizeBelowPct: number;
}

export const DEFAULT_ALLOCATION: AllocationConfig = {
  topN: 10,
  maxPerCluster: 1, // one primary per thesis; correlated siblings are redundant
  maxPerSector: 2,
  halfSizeBelowPct: 0.34,
};

export interface AllocationDecision {
  ticker: string;
  direction: Direction;
  /** The value ranked on (ev when finite, else score). */
  rankValue: number;
  /** 1 = best opportunity today. */
  rank: number;
  /** 0–1 (1 = top of the set). */
  percentile: number;
  /** sector|direction (or ticker|direction when sector is unknown). */
  clusterKey: string;
  /** PRIMARY = the best expression of its thesis; REDUNDANT = a correlated sibling of one already taken. */
  clusterRole: ClusterRole;
  sizing: Sizing;
  /** The WHY — feeds the explainability trace. */
  reasons: string[];
}

const clusterKeyOf = (c: { ticker: string; direction: Direction; sector?: string | null }): string =>
  `${c.sector && c.sector.trim() ? c.sector.trim().toUpperCase() : `#${c.ticker.toUpperCase()}`}|${c.direction}`;

const sectorKeyOf = (c: { ticker: string; sector?: string | null }): string =>
  c.sector && c.sector.trim() ? c.sector.trim().toUpperCase() : `#${c.ticker.toUpperCase()}`;

const rankValueOf = (c: AllocationCandidate): number =>
  c.ev != null && Number.isFinite(c.ev) ? c.ev : c.score;

/**
 * Allocate capital across the cleared setups. Best-first, each candidate is judged against what's ALREADY
 * committed (existing exposure + higher-ranked survivors this pass): it's PRIMARY if it's the first
 * expression of its thesis, REDUNDANT otherwise; and it's sized FULL / HALF / SKIP against the cross-
 * sectional cut, the duplicate-thesis cap, and the sector concentration cap. Deterministic: ties broken by
 * score then ticker so the same set always allocates the same way.
 */
export function allocate(
  candidates: AllocationCandidate[],
  existing: ExistingExposure[] = [],
  config: AllocationConfig = DEFAULT_ALLOCATION,
): AllocationDecision[] {
  const ranked = [...candidates].sort((a, b) => {
    const dv = rankValueOf(b) - rankValueOf(a);
    if (dv !== 0) return dv;
    const ds = b.score - a.score;
    if (ds !== 0) return ds;
    return a.ticker.localeCompare(b.ticker);
  });
  const n = ranked.length;

  // Seed counts with existing exposure — the opportunity-cost anchor: a thesis the book already holds is
  // already "covered", so a fresh add to it is redundant/deprioritized rather than a new independent edge.
  const clusterCount = new Map<string, number>();
  const sectorCount = new Map<string, number>();
  for (const e of existing) {
    clusterCount.set(clusterKeyOf(e), (clusterCount.get(clusterKeyOf(e)) ?? 0) + 1);
    sectorCount.set(sectorKeyOf(e), (sectorCount.get(sectorKeyOf(e)) ?? 0) + 1);
  }

  const out: AllocationDecision[] = [];
  ranked.forEach((c, i) => {
    const ck = clusterKeyOf(c);
    const sk = sectorKeyOf(c);
    const percentile = n > 1 ? (n - i) / n : 1;
    const reasons: string[] = [];

    const clusterSeen = clusterCount.get(ck) ?? 0;
    const sectorSeen = sectorCount.get(sk) ?? 0;
    const role: ClusterRole = clusterSeen === 0 ? "PRIMARY" : "REDUNDANT";

    let sizing: Sizing;
    if (i >= config.topN) {
      sizing = "SKIP";
      reasons.push(`outside today's top ${config.topN} by ${c.ev != null && Number.isFinite(c.ev) ? "EV" : "score"}`);
    } else if (clusterSeen >= config.maxPerCluster) {
      sizing = "SKIP";
      reasons.push(`thesis already covered — duplicate of ${ck} (cap ${config.maxPerCluster})`);
    } else if (sectorSeen >= config.maxPerSector) {
      sizing = "SKIP";
      reasons.push(`sector concentration cap hit for ${sk} (max ${config.maxPerSector})`);
    } else if (role === "REDUNDANT" || percentile <= config.halfSizeBelowPct) {
      sizing = "HALF";
      reasons.push(role === "REDUNDANT" ? "correlated sibling — half size" : "weaker end of today's set — half size");
    } else {
      sizing = "FULL";
      reasons.push(`rank #${i + 1} of ${n} · primary ${ck}`);
    }

    if (sizing !== "SKIP") {
      clusterCount.set(ck, clusterSeen + 1);
      sectorCount.set(sk, sectorSeen + 1);
    }

    out.push({
      ticker: c.ticker.toUpperCase(),
      direction: c.direction,
      rankValue: rankValueOf(c),
      rank: i + 1,
      percentile: Math.round(percentile * 100) / 100,
      clusterKey: ck,
      clusterRole: role,
      sizing,
      reasons,
    });
  });

  return out;
}

/** The book actually taken (FULL/HALF), in rank order — what the desk surfaces as "allocate here today". */
export function allocatedBook(decisions: AllocationDecision[]): AllocationDecision[] {
  return decisions.filter((d) => d.sizing !== "SKIP");
}
