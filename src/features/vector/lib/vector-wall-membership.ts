import type { GexWalls } from "@/lib/providers/gex-wall-levels";

/**
 * WHICH strikes own a bead row at each bucket — a lifecycle with hysteresis, not a per-bucket
 * beauty contest.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────────────
 * `trailsByStrike` selected each bucket's strongest N strikes INDEPENDENTLY, every bucket. A strike
 * hovering around the cut therefore left and re-entered on nearly every tick, and its row rendered
 * as a dotted line. Measured over a full live session (2026-08-18), mean fill = the fraction of the
 * buckets a row spans in which it actually has a bead:
 *
 *   ticker   dominant=5 (shipped)   dominant=20 (everything recorded)
 *   SPX          0.35                    0.47
 *   TSLA         0.71                    0.85
 *   NVDA         0.82                    0.88
 *
 * On SPX **two-thirds of every row was holes**. Nothing was missing from the payload — the recorder
 * had all 20 levels per side in every bucket — the renderer was throwing them away and then
 * throwing away a different five next tick.
 *
 * ── WHY NOT JUST RAISE THE CAP ───────────────────────────────────────────────────────
 * Because that trades this complaint for the opposite one, and the repo has already paid for that
 * lesson: `DOMINANT_WALLS_PER_BUCKET` went 3 -> 5 and the measured result was a MORE STATIC rail —
 * full-width rows grew ~6x faster than births, TSLA regressed on both sides. A bigger top-N means
 * more strikes that never leave, which reads as a frozen grid.
 *
 * Hysteresis dissolves that trade-off instead of picking a side. A strike must be genuinely strong
 * to be BORN (`enterRank`), but only ordinarily relevant to STAY (`holdRank`), and it dies only
 * after `graceBuckets` consecutive buckets of failing that weaker test. Strong persistent walls get
 * continuous rows; weak ones still die. Births and deaths become events in the book rather than
 * artefacts of a ranking that was recomputed from scratch.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────────────
 * It never invents a bead. A strike that is alive but absent from a bucket's recorded ladder emits
 * NOTHING for that bucket — the row keeps its identity across the gap without a fabricated sample,
 * because a rail that fills its own holes is worse than one that shows them.
 */

export type WallMembershipConfig = {
  /** Rank (1-based, by |pct| within the side) a strike must reach to be BORN. */
  enterRank: number;
  /** Weaker rank a live strike must hold to STAY. Must be >= enterRank or there is no hysteresis. */
  holdRank: number;
  /** Consecutive buckets failing `holdRank` before the row dies. */
  graceBuckets: number;
};

/**
 * Enter at the same rank the old per-bucket cap used, so a row is born on exactly the evidence that
 * used to earn a bead — the change is about what happens AFTER birth, not about admitting noise.
 * Hold at 12 of the 20 recorded levels, so an established wall survives ordinary jostling but a
 * strike that has genuinely faded to the bottom of the ladder still dies. Three buckets of grace is
 * 15s at the oracle cadence: long enough to ride out one bad scan, short enough that a real death
 * lands within a candle.
 */
export const DEFAULT_WALL_MEMBERSHIP: WallMembershipConfig = {
  enterRank: 5,
  holdRank: 12,
  graceBuckets: 3,
};

type LiveRow = { missed: number };

/** Strikes ranked strongest-first for one side of one bucket. */
function rankedStrikes(walls: GexWalls | null, side: "callWalls" | "putWalls"): number[] {
  const levels = walls?.[side];
  if (!levels?.length) return [];
  return [...levels]
    .filter((l) => Number.isFinite(l.strike) && Number.isFinite(l.pct))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .map((l) => Math.round(l.strike));
}

/**
 * Resolve row membership across an ORDERED sequence of buckets.
 *
 * Returns, per bucket index, the strikes that own a row AND have data in that bucket — i.e. exactly
 * the set the caller should emit beads for. Callers keep their own bucket ordering; this function
 * does not sort, because the history's order is the caller's contract with the chart's time axis.
 */
export function resolveWallMembership(
  buckets: readonly (GexWalls | null)[],
  side: "callWalls" | "putWalls",
  config: WallMembershipConfig = DEFAULT_WALL_MEMBERSHIP
): Set<number>[] {
  const enterRank = Math.max(1, Math.floor(config.enterRank) || 1);
  // A holdRank below enterRank would be REVERSE hysteresis — harder to stay than to be born, which
  // churns worse than no hysteresis at all. Clamp rather than trust the caller.
  const holdRank = Math.max(enterRank, Math.floor(config.holdRank) || enterRank);
  const grace = Math.max(0, Math.floor(config.graceBuckets) || 0);

  const live = new Map<number, LiveRow>();
  const out: Set<number>[] = [];

  for (const walls of buckets) {
    const ranked = rankedStrikes(walls, side);
    const rankOf = new Map<number, number>();
    for (let i = 0; i < ranked.length; i++) if (!rankOf.has(ranked[i]!)) rankOf.set(ranked[i]!, i + 1);

    // 1. Age existing rows. A row still inside holdRank resets its grace; anything else burns one.
    for (const [strike, row] of [...live]) {
      const rank = rankOf.get(strike);
      if (rank != null && rank <= holdRank) row.missed = 0;
      else if (row.missed >= grace) live.delete(strike);
      else row.missed += 1;
    }

    // 2. Births. Ranking strongly is what earns a NEW row.
    for (let i = 0; i < ranked.length && i < enterRank; i++) {
      if (!live.has(ranked[i]!)) live.set(ranked[i]!, { missed: 0 });
    }

    // 3. Emit only rows this bucket actually has data for — alive-but-absent leaves an honest hole
    //    rather than a fabricated bead.
    const members = new Set<number>();
    for (const strike of live.keys()) if (rankOf.has(strike)) members.add(strike);
    out.push(members);
  }

  return out;
}
