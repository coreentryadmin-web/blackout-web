/**
 * Night Hawk Legacy — bearish-posture historical backtest (operator's continuous-learning
 * mandate, outcome-honesty pillar). A live audit cycle (2026-09-18) found the last 30 sessions'
 * published book was 47 LONG vs 1 SHORT while SPY closed -1.31% with 17/22 red days, and traced
 * the dominant `wrong_direction` failure mode (47.6% of graded plays) as a plausible symptom of
 * that imbalance. `bearish-posture.ts` (PR-N9) already exists specifically to prevent an
 * all-LONG book on a bearish tape ("the machine can only say long or say nothing") via
 * `detectBookPosture()` — a >=2-of-3 signal gate (tide_bias, breadth, composite_regime) — but
 * nothing had ever measured how often that gate actually FIRES against real history. This module
 * answers that, read-only, using data already durably pinned at publish time.
 *
 * NO NEW CAPTURE NEEDED: `publish-context.ts`'s `market` block already pins `tide_bias`,
 * `composite_regime`, and `breadth.pct_advancing` (the BIE bundle) onto every published play's
 * `publish_context` column (`nighthawk_play_outcomes`, already fetched in full by the existing
 * `fetchNighthawkOutcomeAnalytics`) — this just re-derives detectBookPosture()'s own input shape
 * (`NightHawkRegimeContext`) from that already-persisted, already-fetched data and re-runs the
 * SAME unmodified pure gate against it. Zero schema change, zero new DB read, zero live-picks
 * behavior change — pure measurement over history.
 *
 * PURE, no I/O — same posture-of-purity as bearish-posture.ts and every other pure module in
 * this directory.
 */

import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { detectBookPosture, type BookPosture } from "./bearish-posture";
import type { NightHawkRegimeContext } from "./scorer";
import type { TideBias } from "./format";

/**
 * `publish_context.market`'s actual persisted shape (publish-context.ts lines ~240-254) — a
 * narrower, differently-named projection of `NightHawkRegimeContext`, not the type itself
 * (`advance_pct` is stored as `breadth.pct_advancing`). Loosely typed (`unknown`-safe callers)
 * because `publish_context` itself is `Record<string, unknown> | null` on the DB row — this repo's
 * convention for a JSONB blob with no compile-time schema guarantee.
 */
export type PersistedPublishMarket = {
  composite_regime?: string | null;
  tide_bias?: string | null;
  breadth?: { pct_advancing?: number | null } | null;
};

/**
 * Re-derives the exact `NightHawkRegimeContext` shape `detectBookPosture()` consumes from the
 * persisted `publish_context.market` blob. Null-honest: a field absent from the pin (e.g. an
 * older PUBLISH_CONTEXT_VERSION predating the breadth pin) reads as null/NEUTRAL here rather than
 * a fabricated default — the same discipline `detectBookPosture` itself already applies to a
 * missing regime altogether.
 */
export function regimeContextFromPersistedMarket(
  market: PersistedPublishMarket | null | undefined
): NightHawkRegimeContext | null {
  if (!market) return null;
  const tideBiasValue = market.tide_bias;
  const tide_bias: TideBias =
    tideBiasValue === "BULLISH" || tideBiasValue === "BEARISH" || tideBiasValue === "NEUTRAL"
      ? tideBiasValue
      : "NEUTRAL";
  return {
    vix_iv_rank: null,
    tide_bias,
    advance_pct: market.breadth?.pct_advancing ?? null,
    composite_regime: market.composite_regime ?? null,
    anomaly_tickers: [],
  };
}

export type PostureBacktestSession = {
  edition_for: string;
  /** What detectBookPosture() would say given that evening's PINNED regime read. */
  gate_posture: BookPosture;
  gate_reasons: string[];
  /** The raw signal values the gate verdict above was actually computed from — reported
   *  alongside the verdict specifically so a 0%-fire-rate result (or any surprising verdict) is
   *  auditable without a second lookup: a session with tide_bias/composite_regime consistently
   *  null/NEUTRAL across the whole window is evidence of an upstream data-capture gap, while a
   *  session with real bearish-looking values that still read NEUTRAL is evidence the 2-of-3
   *  threshold itself is (or isn't) the limiting factor. Never fabricated — mirrors exactly what
   *  regimeContextFromPersistedMarket derived, including its own nulls. */
  regime: { tide_bias: string; advance_pct: number | null; composite_regime: string | null } | null;
  /** What the book actually published that evening. */
  published_long: number;
  published_short: number;
  /** true when the gate said SHORT but the published book still carried zero shorts — the
   *  specific disconnect worth flagging (gate fired, re-ranking didn't change the outcome). */
  gate_short_but_book_all_long: boolean;
  /** No regime pin at all for this date's rows (predates the market pin, or every row's pin
   *  failed fail-soft) — reported, never silently dropped or defaulted. */
  regime_unavailable: boolean;
};

export type PostureBacktestReport = {
  sessions: PostureBacktestSession[];
  summary: {
    total_sessions: number;
    sessions_with_regime: number;
    gate_fired_short_n: number;
    gate_fired_short_pct: number | null;
    all_long_sessions_n: number;
    gate_short_but_book_all_long_n: number;
  };
};

/**
 * Groups outcome rows by `edition_for` (one regime pin per evening — every play published that
 * night shares it), re-derives the regime and posture verdict ONCE per session (not per play),
 * and cross-references against what the book actually published. `rows` should already be
 * resolved/graded rows from `fetchNighthawkOutcomeAnalytics` or equivalent — this function does
 * no filtering of its own beyond grouping, so a caller controls the window.
 */
export function buildPostureBacktestReport(
  rows: Pick<NighthawkPlayOutcomeRow, "edition_for" | "direction" | "publish_context">[]
): PostureBacktestReport {
  const byEdition = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byEdition.get(row.edition_for);
    if (list) list.push(row);
    else byEdition.set(row.edition_for, [row]);
  }

  const sessions: PostureBacktestSession[] = [...byEdition.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([edition_for, editionRows]) => {
      // Every row published the same night carries an identical regime pin (it's the evening's
      // market state, not per-ticker) — the first row with ANY publish_context is representative.
      const marketBlock = editionRows
        .map((r) => (r.publish_context as { market?: PersistedPublishMarket } | null)?.market)
        .find((m) => m != null);
      const regime = regimeContextFromPersistedMarket(marketBlock ?? null);
      const gate = detectBookPosture(regime);

      const published_long = editionRows.filter((r) => r.direction === "LONG").length;
      const published_short = editionRows.filter((r) => r.direction === "SHORT").length;

      return {
        edition_for,
        gate_posture: gate.posture,
        gate_reasons: gate.reasons,
        regime: regime
          ? { tide_bias: regime.tide_bias, advance_pct: regime.advance_pct ?? null, composite_regime: regime.composite_regime ?? null }
          : null,
        published_long,
        published_short,
        gate_short_but_book_all_long: gate.posture === "SHORT" && published_short === 0,
        regime_unavailable: regime == null,
      };
    });

  const sessionsWithRegime = sessions.filter((s) => !s.regime_unavailable);
  const gateFiredShortN = sessionsWithRegime.filter((s) => s.gate_posture === "SHORT").length;
  const allLongSessionsN = sessions.filter((s) => s.published_short === 0 && s.published_long > 0).length;
  const gateShortButAllLongN = sessions.filter((s) => s.gate_short_but_book_all_long).length;

  return {
    sessions,
    summary: {
      total_sessions: sessions.length,
      sessions_with_regime: sessionsWithRegime.length,
      gate_fired_short_n: gateFiredShortN,
      gate_fired_short_pct:
        sessionsWithRegime.length > 0 ? (gateFiredShortN / sessionsWithRegime.length) * 100 : null,
      all_long_sessions_n: allLongSessionsN,
      gate_short_but_book_all_long_n: gateShortButAllLongN,
    },
  };
}
