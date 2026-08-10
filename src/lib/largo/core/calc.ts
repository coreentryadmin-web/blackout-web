/**
 * CALCULATION ENGINE — the arithmetic Largo must never do in its head.
 *
 * A language model asked to "rank these by dollar volume" or "what's the delta since open" will
 * produce a plausible ordering and a plausible percentage. Plausible is the problem: a mis-ranked
 * list and a mis-computed delta look exactly like correct ones, they pass every grounding check
 * (the inputs are real), and a member acts on them. So ranking, deltas, aggregation and
 * reconciliation happen HERE, in code, and the model narrates the result.
 *
 * DESIGN RULES, all of which exist because the alternative silently lies:
 *
 *  1. **Missing is not zero.** `null` propagates. A ticker with no flow data must not rank last as
 *     if it had $0 of flow — it must be reported as unknown. Coercing null to 0 is the single most
 *     common way a "worst performer" list gets fabricated.
 *  2. **Percent change needs a non-zero base.** `(x - 0) / 0` is Infinity, which renders as "∞%"
 *     or, worse, gets formatted into a real-looking number. Returns null.
 *  3. **Ties are reported, not broken silently.** A ranker that hides a tie invents a winner.
 *  4. **Every output carries its own sample size.** An average over 2 rows and an average over 200
 *     read identically once they are a number in prose.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

export type Num = number | null | undefined;

/** Finite-number guard. `NaN`, `Infinity`, `null`, `undefined` and numeric strings all fail
 *  closed — a string that looks numeric is data the caller has not parsed yet. */
export function fin(v: Num): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Absolute change. Null if either side is unknown — never treat a missing base as zero. */
export function delta(now: Num, then: Num): number | null {
  const a = fin(now);
  const b = fin(then);
  return a == null || b == null ? null : a - b;
}

/**
 * Percent change from `then` to `now`.
 *
 * Null when either side is unknown OR the base is zero. A zero base is not a 0% move and it is not
 * an infinite one — it is undefined, and the only honest rendering is "n/a".
 */
export function pctChange(now: Num, then: Num): number | null {
  const a = fin(now);
  const b = fin(then);
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

export type Stats = {
  n: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** Inputs that were null/NaN and therefore excluded. Reported so the caller can say so. */
  excluded: number;
};

/**
 * Descriptive stats over a numeric column.
 *
 * Returns null for an empty usable set rather than a zero-filled object: an all-null column and a
 * column of genuine zeros are completely different findings, and a `{mean: 0}` shape makes them
 * indistinguishable downstream.
 */
export function stats(values: readonly Num[]): Stats | null {
  const nums: number[] = [];
  let excluded = 0;
  for (const v of values) {
    const f = fin(v);
    if (f == null) excluded += 1;
    else nums.push(f);
  }
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = nums.reduce((s, x) => s + x, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    n: nums.length,
    sum,
    mean: sum / nums.length,
    median,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    excluded,
  };
}

export type Ranked<T> = {
  rank: number;
  item: T;
  value: number;
  /** True when this item shares its value with another — a tie the caller must not hide. */
  tied: boolean;
};

export type RankResult<T> = {
  ranked: Ranked<T>[];
  /** Items with no usable value. NEVER ranked last — they are unknown, not worst. */
  unranked: T[];
  ties: number;
};

/**
 * Rank items by a numeric key.
 *
 * Items whose key is missing come back in `unranked`, not at the bottom of `ranked`. That
 * distinction is the whole point: a ticker with no flow data is not the ticker with the least
 * flow, and quietly sorting it last is how "the weakest name today" gets invented.
 *
 * Ties are flagged rather than broken by input order, because the order rows arrived in is an
 * implementation detail and presenting it as a ranking is fabrication.
 */
export function rankBy<T>(
  items: readonly T[],
  key: (item: T) => Num,
  direction: "desc" | "asc" = "desc"
): RankResult<T> {
  const usable: Array<{ item: T; value: number }> = [];
  const unranked: T[] = [];
  for (const item of items) {
    const v = fin(key(item));
    if (v == null) unranked.push(item);
    else usable.push({ item, value: v });
  }
  usable.sort((a, b) => (direction === "desc" ? b.value - a.value : a.value - b.value));

  const counts = new Map<number, number>();
  for (const u of usable) counts.set(u.value, (counts.get(u.value) ?? 0) + 1);

  let ties = 0;
  const ranked = usable.map((u, i) => {
    const tied = (counts.get(u.value) ?? 0) > 1;
    if (tied) ties += 1;
    return { rank: i + 1, item: u.item, value: u.value, tied };
  });
  return { ranked, unranked, ties };
}

export type Agreement<T> = {
  /** Values that appear more than once — the consensus, if there is one. */
  agreed: T[];
  /** Values appearing exactly once. */
  outliers: T[];
  /** True when at least two distinct values exist — i.e. the sources genuinely disagree. */
  conflict: boolean;
};

/**
 * Do independent sources agree?
 *
 * The primitive behind "where do Helix and Thermal disagree". Deliberately does NOT average or
 * pick a winner: averaging two contradictory reads produces a number no source reported and hides
 * the most valuable finding — that they conflict. The caller reports the disagreement.
 */
export function agreementOf<T>(values: readonly T[], keyOf: (v: T) => string): Agreement<T> {
  const buckets = new Map<string, T[]>();
  for (const v of values) {
    const k = keyOf(v);
    const arr = buckets.get(k);
    if (arr) arr.push(v);
    else buckets.set(k, [v]);
  }
  const agreed: T[] = [];
  const outliers: T[] = [];
  for (const arr of buckets.values()) {
    if (arr.length > 1) agreed.push(arr[0]!);
    else outliers.push(arr[0]!);
  }
  return { agreed, outliers, conflict: buckets.size > 1 };
}

/**
 * Are independent readings of the SAME quantity consistent?
 *
 * Used by cross-product reconciliation: four desks each reporting SPX spot should agree to well
 * under a percent. Returns the spread so the caller can state it rather than assert "they agree".
 */
export function reconcile(
  readings: ReadonlyArray<{ source: string; value: Num }>,
  tolerancePct: number
): { ok: boolean; spreadPct: number | null; min: number | null; max: number | null; usable: number } {
  const nums = readings.map((r) => fin(r.value)).filter((v): v is number => v != null);
  if (nums.length < 2) return { ok: true, spreadPct: null, min: nums[0] ?? null, max: nums[0] ?? null, usable: nums.length };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  // Guard a zero base the same way pctChange does — a spread over 0 is undefined, not infinite.
  const spreadPct = min === 0 ? null : ((max - min) / Math.abs(min)) * 100;
  return { ok: spreadPct == null ? true : spreadPct <= tolerancePct, spreadPct, min, max, usable: nums.length };
}

/** Win/loss/breakeven tally that refuses to invent a rate from nothing. */
export function winRate(rows: ReadonlyArray<{ outcome: string }>): {
  wins: number;
  losses: number;
  breakeven: number;
  graded: number;
  ratePct: number | null;
} {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  for (const r of rows) {
    const o = String(r.outcome ?? "").toLowerCase();
    if (o.includes("win") || o === "target" || o === "doubled") wins += 1;
    else if (o.includes("loss") || o.includes("stop")) losses += 1;
    else if (o.includes("breakeven") || o.includes("flat")) breakeven += 1;
  }
  const graded = wins + losses + breakeven;
  // A rate over zero graded rows is not 0% — it is unknown. Reporting 0% would read as "we lose
  // everything" when the truth is "nothing has been graded yet".
  return { wins, losses, breakeven, graded, ratePct: graded === 0 ? null : (wins / graded) * 100 };
}

/** Format a number for member-facing text, or `—` when it is genuinely unknown. Never "0" or "NaN". */
export function fmt(v: Num, opts: { decimals?: number; suffix?: string; sign?: boolean } = {}): string {
  const f = fin(v);
  if (f == null) return "—";
  const d = opts.decimals ?? 2;
  const body = Math.abs(f).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = f < 0 ? "-" : opts.sign ? "+" : "";
  return `${sign}${body}${opts.suffix ?? ""}`;
}
