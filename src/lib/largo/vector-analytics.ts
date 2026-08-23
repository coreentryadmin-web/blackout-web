import "server-only";

/**
 * VECTOR ANALYTICS for Largo — the nine client-only Vector analytics, served server-side.
 *
 * THE GAP THIS CLOSES. A coverage audit of Largo's 117 tools against every product panel found
 * SPX Slayer, Helix, Thermal and Night Hawk fully reachable at the data level and Vector NOT:
 * `get_vector_full_state` and `get_vector_pulse` cover walls / flip / magnet / beads / play /
 * technicals, and nine analytics had zero references from `src/lib/largo` or `src/lib/bie` —
 * volume profile, market structure, auto-fib swing, key levels, OpEx calendar, daily dealer regime,
 * screener, ticker comparison, coaching alerts. Every one of them is a panel a member can see and
 * ask about.
 *
 * ONE BAR FETCH. `fetchVectorSeedBars` is the single expensive call here (three sessions of 1m
 * bars); all four bar-derived analytics are composed from that one result, so Largo pays for the
 * chart's data once rather than once per panel — and, more importantly, every level it quotes is
 * measured at the SAME instant. Four separate fetches could put the POC and the opening range on
 * different bar sets, and the disagreement would be invisible in the answer.
 *
 * EVERY SECTION FAILS OPEN INDEPENDENTLY. A cold universe snapshot must not blank the volume
 * profile. Each block resolves through its own `.catch(() => null)` and carries an explicit reason
 * when empty, because "we could not read it" and "it is empty" are different answers and Largo has
 * to be able to tell a member which one it is.
 */

import { roundFloats } from "@/lib/round-floats";
import { fitVectorAnalyticsForModel } from "@/lib/largo/vector-analytics-fit";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { computeVectorBarAnalytics, opexContext } from "@/lib/largo/vector-analytics-core";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
// Type-only: erased at build time, so this does NOT pull the screener into the module graph — the
// implementation stays behind the dynamic import below, as it was.
import type { VectorUniverseRow } from "@/features/vector/lib/vector-universe";

/** Screener rows returned to Largo. The panel paginates; an LLM read does not need the tail. */
const MAX_SCREENER_ROWS = 15;

export type VectorAnalyticsOptions = {
  timeframeMin?: number;
  openingRangeMinutes?: number;
  /** Sessions of dealer-regime history. Clamped by the loader to [1, 30]. */
  regimeDays?: number;
};

export async function vectorAnalyticsForLargo(
  rawTicker?: string | null,
  opts: VectorAnalyticsOptions = {}
) {
  const ticker = normalizeVectorTicker(rawTicker || "SPX");
  const nowMs = Date.now();

  try {
    const [{ fetchVectorSeedBars }, { loadDailyRegime }, { loadVectorUniverseSnapshot }] = await Promise.all([
      import("@/features/vector/lib/vector-seed-bars"),
      import("@/features/vector/lib/vector-daily-regime-server"),
      import("@/features/vector/lib/vector-universe"),
    ]);

    const [seed, regime, universe] = await Promise.all([
      fetchVectorSeedBars(ticker).catch(() => null),
      loadDailyRegime(ticker, opts.regimeDays).catch(() => null),
      loadVectorUniverseSnapshot().catch(() => null),
    ]);

    const bars = seed?.bars ?? [];
    const barAnalytics = computeVectorBarAnalytics(bars, {
      timeframeMin: opts.timeframeMin,
      openingRangeMinutes: opts.openingRangeMinutes,
      // Last close, not a separate live quote: the analytics below are all measured ON these bars,
      // and a spot from a different lane would put the swing floor and the golden pocket on a price
      // the bars never printed.
      spot: bars.length ? bars[bars.length - 1]!.close : null,
    });

    // ── SCREENER + COMPARISON ───────────────────────────────────────────────────────────────────
    // Both read the SAME universe snapshot the /vector scanner and comparison strip read, through
    // the same two production functions. The snapshot is rebuilt by a 5-min cron and served stale
    // by design, so `updated_at` travels with the rows — a scanner list is only as current as the
    // sweep behind it, and an hour-old "nearest flip" is a different claim from a live one.
    let screener: unknown = null;
    let comparison: unknown = null;
    if (universe?.rows?.length) {
      const [{ screenUniverse, absFlipDistancePct }, { buildTickerComparisonRows }] = await Promise.all([
        import("@/features/vector/lib/vector-screener"),
        import("@/features/vector/lib/vector-ticker-comparison"),
      ]);
      const compact = (r: { ticker: string; spot: number | null; gammaFlip: number | null; topCallWall: number | null; topPutWall: number | null; topCallPct: number | null; topPutPct: number | null }) => ({
        ticker: r.ticker,
        spot: r.spot,
        gamma_flip: r.gammaFlip,
        top_call_wall: r.topCallWall,
        top_put_wall: r.topPutWall,
        top_call_pct: r.topCallPct,
        top_put_pct: r.topPutPct,
      });
      /**
       * Serve ONE preset with the two numbers a ranked list is meaningless without: how many rows
       * the preset's filter actually matched, and how many of those could be ranked at all.
       *
       * TWO DEFECTS THIS REPLACES, both measured against the real `screenUniverse` (see FINDINGS):
       *
       * (1) **The cap was silent.** Each list was `.slice(0, 15)` with `universe_size` as the only
       *     denominator in the payload. On a 55-name universe `nearest_flip` matched all 55 and
       *     served 15 — 40 dropped with nothing to say so — while `most_pinned` (regime `above`)
       *     matched 30 and `most_explosive` (regime `below`) matched 16. So `universe_size` was
       *     the right denominator for NONE of the three, and asking "what share of the universe is
       *     pinned?" got 15/55 = 27% when the true answer was 30/55.
       *
       * (2) **Rows with no metric were served in ranked positions.** `screenUniverse` sorts
       *     null-metric rows last and its docblock promises "a name with no flip data must never
       *     rank as 'nearest to flip'" — which it honours. Taking a fixed-size PREFIX broke that
       *     promise here, at the boundary: on a mid-warm universe with 6 of 55 names populated,
       *     `nearest_flip` served 15 rows of which **9 had no gamma flip at all**, occupying ranks
       *     7 through 15 of a list the tool description calls "nearest their gamma flip". That is
       *     absence published as measurement, and the fix belongs at the model's tool boundary
       *     rather than in the shared screener the desk UI also renders.
       */
      const servePreset = (
        preset: "nearest-flip" | "most-pinned" | "most-explosive",
        rankable: (r: VectorUniverseRow) => boolean,
        universeFilter: string,
        basis: string
      ) => {
        const matched = screenUniverse(universe.rows, { preset });
        // Drop unrankable rows BEFORE the cap, never after — that ordering is the whole fix.
        const ranked = matched.filter(rankable);
        const served = ranked.slice(0, MAX_SCREENER_ROWS);
        return {
          basis,
          universe_filter: universeFilter,
          /** Rows this preset's filter matched — the denominator for "how many are X?". */
          matched_universe: matched.length,
          /** Of those, how many had a usable metric and could legitimately be ranked. */
          rankable_rows: ranked.length,
          /** Matched but unrankable — a name the sweep has not populated yet, NOT a name that scored badly. */
          excluded_no_metric: matched.length - ranked.length,
          returned: served.length,
          /** True when the list is a top-N of a longer ranking. `returned` is then NOT a count of anything real. */
          truncated: ranked.length > served.length,
          max_rows: MAX_SCREENER_ROWS,
          rows: served.map(compact),
          empty_reason: ranked.length
            ? null
            : matched.length
              ? "matched_but_no_row_has_this_metric_yet"
              : "no_universe_row_matches_this_filter",
        };
      };

      const hasFlip = (r: VectorUniverseRow) => absFlipDistancePct(r) != null;
      // `wallStrength` coerces missing walls to 0 rather than null, so "no wall data" and "walls
      // measured at zero" are the same number to the sorter. Test the inputs, not the metric.
      const hasWall = (r: VectorUniverseRow) => r.topCallPct != null || r.topPutPct != null;

      screener = {
        universe_size: universe.rows.length,
        updated_at: new Date(universe.updatedAt).toISOString(),
        // The sweep's own age, in the market's clock. A scanner list is only as current as the
        // sweep behind it, and "how stale is this" is not answerable from two ISO instants a
        // reader has to subtract — see the note on `as_of` above.
        updated_at_et: etStamp(universe.updatedAt),
        updated_at_session_date: etSessionDate(universe.updatedAt),
        /** The three curated desk presets the scanner ships — each is a different question, so all
         *  three are returned rather than one default that silently answers only one of them.
         *  Each carries its OWN denominators; `universe_size` above is the sweep's size and is not
         *  the denominator for any individual list. */
        nearest_flip: servePreset(
          "nearest-flip",
          hasFlip,
          "none — the whole universe",
          "smallest |gamma flip − spot| / spot first"
        ),
        most_pinned: servePreset(
          "most-pinned",
          hasWall,
          "spot at or above the gamma flip (dealers pinning)",
          "strongest wall on either side (0–100 net-gamma share), descending"
        ),
        most_explosive: servePreset(
          "most-explosive",
          hasFlip,
          "spot below the gamma flip (dealers amplifying)",
          "smallest |gamma flip − spot| / spot first"
        ),
      };
      const rows = buildTickerComparisonRows(ticker, universe.rows);
      comparison = {
        // `buildTickerComparisonRows` returns [] below two resolvable rows — nothing to compare
        // against is not the same as a comparison showing no difference.
        rows: rows.map((r) => ({
          ticker: r.ticker,
          is_active: r.isActive,
          regime: r.regime,
          flip_distance_pct: r.flipDistancePct,
          wall_strength: r.wallStrength,
        })),
        empty_reason: rows.length ? null : "fewer_than_two_rows_resolved",
      };
    }

    // ── COACHING ────────────────────────────────────────────────────────────────────────────────
    // SPX-ONLY AND SESSION-GATED, deliberately scoped rather than always-on. `buildCoachingAlerts`
    // reads the merged SPX desk + SPX GEX positioning and returns [] outside the SPX engine's cron
    // window; calling it for NVDA would return SPX levels under an NVDA question, which is the
    // exact class of confident-but-wrong answer this whole tool exists to prevent.
    const isSpx = ticker === "SPX" || ticker === "SPXW";
    const coaching = isSpx
      ? await import("@/features/vector/lib/vector-coaching")
          .then((m) => m.buildCoachingAlerts())
          .then((c) => ({
            alerts: c.alerts,
            spx_price: c.spxPrice,
            call_wall: c.callWall,
            put_wall: c.putWall,
            vwap: c.vwap,
            /** [] outside the SPX engine's session window means "not evaluated", not "all clear". */
            empty_reason: c.alerts.length ? null : "outside_session_window_or_no_trigger",
          }))
          .catch(() => null)
      : null;

    // Rounded at the data boundary, THEN fitted for the transport. Order matters: rounding shrinks
    // the payload (7499.360000000001 -> 7499.36), so fitting first would budget against numbers
    // wider than the ones actually served and trim more than necessary.
    return fitVectorAnalyticsForModel(roundFloats({
      available: true,
      ticker,
      as_of: new Date(nowMs).toISOString(),
      // `as_of` alone is a bare UTC instant, and almost everything below it is SESSION-scoped:
      // the opening range, HOD/LOD, the prior-day pivots, the OpEx day count, and the per-session
      // daily_regime rows. Between ~20:00 ET and midnight the UTC date is already TOMORROW, so a
      // reader resolving "today" from `as_of` lands a session ahead of the data it is labelling —
      // the same inversion that had a live SPX figure dated forward and a close fabricated for the
      // current session. Contract C1: ship the market's clock next to the instant.
      as_of_et: etStamp(nowMs),
      session_date: etSessionDate(nowMs),
      session_ymd: seed?.sessionYmd ?? null,

      ...(barAnalytics ?? {}),
      /** Distinguishes a chart with nothing on it from a bar fetch that failed. */
      bars_empty_reason: barAnalytics ? null : seed ? "no_bars_for_session" : "seed_bar_fetch_failed",

      /** OPEX CALENDAR — the chart's own third-Friday marks, plus days-until. */
      opex: opexContext(nowMs),

      /** DAILY DEALER REGIME — end-of-session flip + walls per recorded session. Short-range BY
       *  DESIGN (~15-day retention); `coverage` states the real window so a short series can never
       *  be presented as long-range history. */
      daily_regime: regime
        ? {
            rows: regime.rows,
            coverage: regime.coverage,
            retention_note: regime.retentionNote,
          }
        : null,

      screener,
      ticker_comparison: comparison,
      coaching,
      /** Named so an absent block is never read as an empty one. */
      unavailable_sections: [
        ...(barAnalytics ? [] : ["bar_analytics"]),
        ...(regime ? [] : ["daily_regime"]),
        ...(universe?.rows?.length ? [] : ["screener", "ticker_comparison"]),
        ...(isSpx && !coaching ? ["coaching"] : []),
      ],
      /** Coaching is an SPX desk product, not a per-ticker one — its absence on a single name is
       *  scope, not an outage, and must not be reported as one. */
      coaching_scope: isSpx ? "spx" : "not_applicable_non_spx",
    }));
  } catch (e) {
    return {
      available: false,
      ticker,
      error: e instanceof Error ? e.message : "vector_analytics_failed",
    };
  }
}
