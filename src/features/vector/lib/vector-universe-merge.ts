/**
 * Universe-snapshot MERGE — how a freshly built roster is combined with the one already stored.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────────────────
 * `buildVectorUniverseSnapshot` fans out over the whole universe with `Promise.allSettled`, keeps
 * the rows that resolved, and persisted that set UNCONDITIONALLY. Nothing ever asked whether the
 * result was worse than what it was replacing. So one bad fan-out — an upstream blip, a rate
 * limit, a cold cache after a deploy — overwrote a healthy roster with whatever few tickers
 * happened to survive, and every consumer read that as the truth until the next rebuild.
 *
 * Measured live on production 2026-08-18, polling the same endpoint every 5s for 74s:
 *
 *     rows  updatedAt   median row age
 *        4  15:43:55    258s -> 311s      (10 of 12 samples: AMZN, FN, QQQ, SOXL)
 *        3  15:41:39    318s
 *       62  15:21:58    1488s
 *       64  15:45:18    46s
 *
 * Four different snapshots alive at once, and the one being served most often held FOUR tickers
 * and was ageing. The bead rails show the consequence: the sweep works from this roster, so
 * tickers outside it fall to the slow on-demand path — blended-rail median gaps of 60s on
 * TSLA/META/AAPL/AMD against a 5s spec, and 300s on the narrowed rails.
 *
 * A second path had the same shape: `ensureTickerInUniverseSnapshot` does load -> append -> store
 * with only IN-PROCESS dedup, so two ECS tasks appending different tickers each persist their own
 * merge and the loser's rows disappear. That is a lost update, and no amount of in-process
 * bookkeeping fixes it across tasks.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * A rebuild is a set of OBSERVATIONS, not a replacement roster. Merge it over what is stored:
 * a ticker that resolved this round gets its fresh row, a ticker that failed keeps its previous
 * row until it goes stale, and a row nothing has refreshed for `maxAgeMs` falls out on its own.
 * That makes a partial build cost nothing — it simply refreshes fewer rows — while a genuinely
 * shrinking universe still converges, just over minutes instead of instantly.
 *
 * Deliberately NOT a "keep the biggest roster" rule: that would pin dead tickers forever and can
 * never shrink. Age is the honest arbiter, because it is the thing that actually says whether a
 * row still describes the market.
 */

export type UniverseRowLike = {
  ticker: string;
  /** Upstream observation time in epoch ms. Null when the builder could not date the row. */
  asOf?: number | null;
  /**
   * Set once — the first cycle a row is carried without a usable `asOf` — and then carried forward
   * unchanged on every subsequent cycle it survives undated. Exists because the undated fallback
   * used to be the SNAPSHOT's own `updatedAt`, which every refresh bumps to `Date.now()` regardless
   * of which rows it actually refreshed; that made an undated row's computed "age" reset to ~0 on
   * every cycle it merely survived, so it never aged out (real incident: a ticker whose builder
   * keeps failing served spot:null/asOf:null indefinitely while a solo per-ticker fetch for the same
   * ticker returned real, current data). Stamping `undatedSince` once and carrying it gives an
   * undated row its own honest clock, independent of how often the container timestamp moves.
   */
  undatedSince?: number | null;
};

export type UniverseSnapshotLike<TRow extends UniverseRowLike = UniverseRowLike> = {
  updatedAt: number;
  rows: TRow[];
};

/**
 * How long a row survives without being refreshed.
 *
 * 15 minutes: long enough to ride out a multi-minute upstream outage (the failure this exists
 * for), short enough that a ticker genuinely dropped from the universe disappears within a few
 * rebuild cycles rather than lingering all session.
 */
export const UNIVERSE_ROW_MAX_AGE_MS = 15 * 60 * 1000;

/** A stamp further ahead of `nowMs` than this is untrustworthy (cross-process clock skew writing
 *  `asOf`/`updatedAt`), not "extra fresh" — same shape as Helix's FUTURE_PRINT_TOLERANCE_MS. */
const FUTURE_STAMP_TOLERANCE_MS = 60 * 1000;

export type MergeResult<TRow extends UniverseRowLike> = {
  rows: TRow[];
  /** Rows taken from the fresh build. */
  refreshed: number;
  /** Rows carried over because this build did not produce them. */
  carried: number;
  /** Rows dropped because nothing refreshed them inside `maxAgeMs`. */
  expired: number;
};

/**
 * Merge a freshly built roster over the stored one.
 *
 * `nowMs` is injected rather than read from the clock so this is deterministic under test — the
 * expiry rule is the whole point of the function and it must be pinned, not sampled.
 */
export function mergeUniverseSnapshot<TRow extends UniverseRowLike>(
  previous: UniverseSnapshotLike<TRow> | null | undefined,
  fresh: readonly TRow[] | null | undefined,
  nowMs: number,
  maxAgeMs: number = UNIVERSE_ROW_MAX_AGE_MS
): MergeResult<TRow> {
  const byTicker = new Map<string, TRow>();
  // Every undated ticker's frozen undatedSince, captured before any expiry decision below — so a
  // ticker the previous-rows loop just expired can still have its TRUE age carried into the
  // fresh-rows loop, instead of that loop treating a missing byTicker entry as "never seen undated
  // before" and handing it a brand-new nowMs clock. See the fresh-rows loop's BUG FIX comment.
  const priorUndatedSince = new Map<string, number>();
  let carried = 0;
  let expired = 0;

  // Previous rows first, so a fresh row of the same ticker overwrites it below.
  for (const row of previous?.rows ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const hasAsOf = Number.isFinite(row?.asOf as number);
    // A row with no usable `asOf` cannot be aged out on evidence from the row itself. The first
    // time it is seen undated, fall back to the snapshot's own `updatedAt` (a legacy row read
    // straight from storage has no better evidence of when it went undated) — but FREEZE that as
    // `undatedSince` on the carried row from then on, rather than re-deriving it from
    // `previous.updatedAt` every cycle. `updatedAt` is bumped to `Date.now()` on every refresh
    // regardless of which rows actually refreshed, so re-deriving it each time reset an undated
    // row's "age" to ~0 every cycle it merely survived and it never aged out.
    let undatedSince: number | undefined;
    if (!hasAsOf) {
      undatedSince = Number.isFinite(row?.undatedSince as number)
        ? (row.undatedSince as number)
        : Number.isFinite(previous?.updatedAt as number)
          ? (previous!.updatedAt as number)
          : nowMs;
      priorUndatedSince.set(ticker, undatedSince);
    }
    const stamp = hasAsOf ? (row.asOf as number) : (undatedSince as number);
    const ageMs = nowMs - stamp;
    // BUG FIX (2026-09-03): a future-dated stamp (cross-process clock skew across the ECS tasks
    // that write asOf/updatedAt) used to produce a negative age that never exceeded maxAgeMs,
    // carrying an untrustworthy row forward indefinitely instead of expiring it like any other
    // row whose age cannot be verified.
    if (ageMs > maxAgeMs || ageMs < -FUTURE_STAMP_TOLERANCE_MS) {
      expired += 1;
      continue;
    }
    byTicker.set(ticker, hasAsOf ? row : ({ ...row, undatedSince } as TRow));
    carried += 1;
  }

  let refreshed = 0;
  for (const row of fresh ?? []) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    if (byTicker.has(ticker)) carried -= 1; // it is being refreshed, not carried
    const freshHasAsOf = Number.isFinite(row?.asOf as number);
    if (freshHasAsOf) {
      byTicker.set(ticker, row);
      refreshed += 1;
      continue;
    }
    // A freshly built row can itself be undated (the builder failed to date it this cycle too) —
    // give it the same honest clock so the NEXT cycle, where it becomes `previous`, ages it
    // correctly instead of treating it as brand-new every time.
    //
    // BUG FIX (2026-09-06): a ticker present in fresh EVERY cycle but never resolving an asOf (a
    // persistently-broken chain fetch, not a dropped-from-the-fan-out one) needed two fixes:
    //  1. Read priorUndatedSince (captured above, before expiry) rather than the fresh row's own
    //     undatedSince field, which a brand-new row object from this cycle's build never carries -
    //     falling straight through to nowMs every cycle and never accumulating any age at all.
    //  2. Apply the SAME maxAgeMs expiry check the previous-rows loop applies. Fix 1 alone still
    //     left the ticker immortal: once genuinely stale, the previous-rows loop above drops it
    //     from byTicker (increments expired, continues) - but this loop still runs unconditionally
    //     for every row in fresh and would resurrect it right back with whatever clock it
    //     computed, on every cycle, forever. A row still undated after maxAgeMs must fall out even
    //     while the fan-out keeps attempting it - reappearing in fresh without new evidence (a
    //     real asOf) is not evidence the row is still worth serving.
    //
    // Whenever this ticker was ALSO undated in previous.rows, both loops compute the exact same
    // ageMs off the exact same priorUndatedSince stamp and the same nowMs, so they always agree on
    // expired-or-not - the previous-rows loop above already incremented expired for it if this
    // branch is reached. A ticker with no previous-rows entry starts at age 0 here and can never
    // already be expired. So expired is never incremented again below.
    const undatedSince = Number.isFinite(row?.undatedSince as number)
      ? (row.undatedSince as number)
      : priorUndatedSince.get(ticker) ?? nowMs;
    const ageMs = nowMs - undatedSince;
    if (ageMs > maxAgeMs || ageMs < -FUTURE_STAMP_TOLERANCE_MS) {
      refreshed += 1; // still attempted this cycle - it just didn't survive
      continue;
    }
    byTicker.set(ticker, { ...row, undatedSince } as TRow);
    refreshed += 1;
  }

  const rows = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { rows, refreshed, carried, expired };
}

/**
 * Should this build be allowed to REPLACE the stored snapshot outright?
 *
 * Only when it is complete. A build that lost rows to failures is an incomplete observation and
 * must go through the merge instead — that is the whole distinction the old code collapsed by
 * persisting `allSettled`'s survivors as if they were the roster.
 */
export function isCompleteBuild(attempted: number, produced: number): boolean {
  return attempted > 0 && produced >= attempted;
}
