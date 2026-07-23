/**
 * BANGER SCALE-OUT TRACK RECORD (step-6b reader) — the nighthawk-side read surface that turns the pinned
 * `scale_out_grade` blobs (written by the outcomes cron, banger-scale-out-grade.ts) into a read-only
 * track record + the graduation verdict that decides whether the live managed scale-out exit activates.
 *
 * WHY nighthawk-side: recommendScaleOut in calibration.ts reads the 0DTE ledger (zerodte_setup_log), but
 * bangers live only in nighthawk_play_outcomes. This reader feeds the SAME pure graduation rule
 * (recommendScaleOutFromGrades) the blobs pinned on the nighthawk table — one identical bar, two ledgers.
 * Read-only + non-gating: it reports evidence; a human/PR still flips the live exit on when it reads enforce.
 */
import {
  recommendScaleOutFromGrades,
  readScaleOutGradeBlob,
  type ScaleOutRecommendation,
} from "@/lib/zerodte/calibration";
import { fetchNighthawkScaleOutGrades } from "@/lib/db";

export type BangerTrackRecordRow = {
  edition_for: string;
  ticker: string;
  scale_out_realized_mult: number | null;
  hold_mult: number | null;
  ungradeable: boolean;
};

export type BangerScaleOutTrackRecord = {
  /** The coded graduation verdict (enforce / keep_calibrating / insufficient_data) + its evidence. */
  recommendation: ScaleOutRecommendation;
  /** How many pinned rows were GRADEABLE (a real realized+hold pair) vs ungradeable (thin/expired weekly). */
  n_total: number;
  n_gradeable: number;
  n_ungradeable: number;
  /** Fraction of gradeable plays whose scale-out realized > 1× (came out green) — a track-record readout,
   *  NOT the graduation criterion (which is EV: mean realized vs mean hold). */
  green_rate_pct: number | null;
  /** Mean realized multiple under the scale-out, and the hold-to-expiry it's measured against. */
  mean_realized_mult: number | null;
  mean_hold_mult: number | null;
  /** Per-play rows, most-recent first — the read-only banger track record for the surface. */
  rows: BangerTrackRecordRow[];
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** PURE: summarize pinned banger grade blobs into the track record + verdict. Testable without the DB. */
export function summarizeBangerScaleOut(
  graded: Array<{ edition_for: string; ticker: string; scale_out_grade: Record<string, unknown> | null }>
): BangerScaleOutTrackRecord {
  const rows: BangerTrackRecordRow[] = graded.map((g) => {
    const b = readScaleOutGradeBlob(g.scale_out_grade);
    return {
      edition_for: g.edition_for,
      ticker: g.ticker,
      scale_out_realized_mult: b?.real ?? null,
      hold_mult: b?.hold ?? null,
      ungradeable: b?.ungradeable ?? true, // an unparseable blob is treated as ungradeable, never imputed
    };
  });
  const readings = graded.map((g) => readScaleOutGradeBlob(g.scale_out_grade));
  const recommendation = recommendScaleOutFromGrades(readings);

  const gradeable = rows.filter((r) => !r.ungradeable && r.scale_out_realized_mult != null && r.hold_mult != null);
  const nGradeable = gradeable.length;
  const greens = gradeable.filter((r) => (r.scale_out_realized_mult ?? 0) > 1).length;
  const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const meanReal = mean(gradeable.map((r) => r.scale_out_realized_mult as number));
  const meanHold = mean(gradeable.map((r) => r.hold_mult as number));

  return {
    recommendation,
    n_total: rows.length,
    n_gradeable: nGradeable,
    n_ungradeable: rows.length - nGradeable,
    green_rate_pct: nGradeable ? r2((greens / nGradeable) * 100) : null,
    mean_realized_mult: meanReal != null ? r2(meanReal) : null,
    mean_hold_mult: meanHold != null ? r2(meanHold) : null,
    // most-recent first for the surface
    rows: [...rows].sort((a, b) => (a.edition_for < b.edition_for ? 1 : a.edition_for > b.edition_for ? -1 : 0)),
  };
}

/** Fetch the pinned banger grades within lookback and summarize them (verdict + track record). */
export async function getBangerScaleOutTrackRecord(lookbackDays = 120): Promise<BangerScaleOutTrackRecord> {
  const graded = await fetchNighthawkScaleOutGrades(lookbackDays);
  return summarizeBangerScaleOut(graded);
}
