/**
 * BAND / TIME-OF-DAY A/B — pure bucketing and comparison, no IO.
 *
 * WHY THIS EXISTS. The `/record` endpoint already reports per-band and per-time-of-day win
 * rates, and reading those raw point estimates is what produced the claim that the 55-64 score
 * band "outperforms" 65+ (+1.45% vs -4.97% average P&L, on n=10 against n=124). A point estimate
 * on ten plays says almost nothing: one flipped outcome moves it ten points. Acting on it would
 * be exactly the small-sample fluke-chasing `swing/calibration.ts` was built to prevent.
 *
 * So every bucket here carries its Wilson interval, and every head-to-head carries a
 * difference-of-proportions CI. A comparison only counts as REAL when that CI excludes zero.
 * Both come from `src/lib/zerodte/calibration-stats.ts` — the production stats the graduation
 * ladder already uses — rather than a second implementation that could drift from it.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

/**
 * A graded play, reduced to only what the comparison needs:
 * `{ score: number|null, etMinutes: number|null, pnlPct: number|null, direction: string|null }`
 * where `etMinutes` is wall-clock minutes since ET midnight at flag time.
 */

/** `"09:47"` / `"9:47 AM"` → minutes since ET midnight. Null when unparseable — an unreadable
 *  stamp must drop the row from the time analysis, never bucket it as midnight. */
export function etMinutesOf(stamp) {
  if (typeof stamp !== "string") return null;
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(stamp);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * Score bands. Deliberately FINER than the endpoint's three, and cut on the live floor (65) so
 * the "is the floor in the right place" question is directly readable: the two bands either side
 * of it are separate rows.
 */
export const SCORE_BANDS = [
  { label: "<45", lo: -Infinity, hi: 45 },
  { label: "45-54", lo: 45, hi: 55 },
  { label: "55-64", lo: 55, hi: 65 },
  { label: "65-74", lo: 65, hi: 75 },
  { label: "75-84", lo: 75, hi: 85 },
  { label: "85+", lo: 85, hi: Infinity },
];

/** ET session windows, matching the ones the record endpoint reports so the two can be diffed. */
export const TOD_WINDOWS = [
  { label: "open 9:30-9:50", lo: 9 * 60 + 30, hi: 9 * 60 + 50 },
  { label: "prime 9:50-11:00", lo: 9 * 60 + 50, hi: 11 * 60 },
  { label: "midday 11:00-14:00", lo: 11 * 60, hi: 14 * 60 },
  { label: "late 14:00-15:30", lo: 14 * 60, hi: 15 * 60 + 30 },
];

/** Bucket by a [lo, hi) range over a numeric accessor. Rows whose value is null are DROPPED,
 *  never defaulted — a missing score is not a zero score. */
export function bucketBy(plays, bands, valueOf) {
  return bands.map((b) => {
    const rows = plays.filter((p) => {
      const v = valueOf(p);
      return v != null && Number.isFinite(v) && v >= b.lo && v < b.hi;
    });
    const graded = rows.filter((p) => p.pnlPct != null && Number.isFinite(p.pnlPct));
    const wins = graded.filter((p) => p.pnlPct > 0).length;
    const sum = graded.reduce((a, p) => a + p.pnlPct, 0);
    return {
      label: b.label,
      n: graded.length,
      wins,
      winRate: graded.length ? wins / graded.length : null,
      avgPnl: graded.length ? sum / graded.length : null,
    };
  });
}

/**
 * Is bucket A genuinely better than bucket B, or is the gap inside the noise?
 *
 * `verdict` is the whole point of the harness: SEPARATED only when the difference CI excludes
 * zero. INCONCLUSIVE is the honest and by far the most common answer at these sample sizes, and
 * it must read as "no evidence", never as "no difference".
 */
export function compareBuckets(a, b, diffCI) {
  const d = diffCI(b.wins, b.n, a.wins, a.n);
  const separated = d.lo > 0 || d.hi < 0;
  return {
    a: a.label,
    b: b.label,
    diffPts: d.diff * 100,
    loPts: d.lo * 100,
    hiPts: d.hi * 100,
    verdict: !a.n || !b.n ? "NO DATA" : separated ? (d.diff > 0 ? "A SEPARATED" : "B SEPARATED") : "INCONCLUSIVE",
  };
}

/** The smallest per-bucket n at which a 15-point win-rate gap could clear a 95% CI — the
 *  "how much more data do we need" number, so an inconclusive result comes with a target
 *  rather than a shrug. Assumes the worst-case p(1-p)=0.25 on both sides. */
export function nNeededForGap(gapPts, z = 1.96) {
  const gap = gapPts / 100;
  if (gap <= 0) return Infinity;
  return Math.ceil((2 * 0.25 * z * z) / (gap * gap));
}
