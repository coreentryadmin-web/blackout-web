// Pure per-row shaping for the admin tier-export route (GET /api/admin/nighthawk/tier-export).
// Mirrors the 0DTE lane's own tier-export precedent (src/lib/zerodte/tier-export.ts, Task #59) —
// the public /api/market/nighthawk/record route (analytics.ts's getNighthawkMetrics) only ever
// returns AGGREGATE stats, dropping the per-play `score` that a real score-calibration study
// needs (e.g. "does a play scored 42 actually win close to the rate its tier narrative claims" —
// the swing lane's own swing-score-calibration.mjs answers this question for Swings; Legacy has
// no equivalent because no route exposes the per-row score+outcome pair it would need). This
// route exposes it directly, admin-gated read-only. Split out so the field mapping is
// unit-testable without a live database.
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

export type NighthawkTierExportRow = {
  edition_for: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  conviction: string;
  score: number | null;
  outcome: NighthawkPlayOutcomeRow["outcome"];
  /** One-way INVALIDATED pull latch — a pulled play's grade is counterfactual-only and must
   *  never be treated as a real decided outcome by a downstream calibration study. */
  pulled: boolean;
};

export function buildNighthawkTierExportRow(row: NighthawkPlayOutcomeRow): NighthawkTierExportRow {
  return {
    edition_for: row.edition_for,
    ticker: row.ticker,
    direction: row.direction,
    conviction: row.conviction,
    score: row.score,
    outcome: row.outcome,
    pulled: row.pulled ?? false,
  };
}
