// DB fallback for /api/nighthawk/play-status when the 24h Redis blob has expired.
// Morning verdicts are durably pinned on nighthawk_play_outcomes.morning_verdict
// (first-write-wins at 9:15 ET) — this module rebuilds the member-facing status
// payload from those pins without re-running the cron.

import type { MorningConfirmResult } from "@/app/api/cron/nighthawk-morning-confirm/route";
import { readNighthawkMorningVerdict } from "@/lib/bie/nighthawk-edition-read";
import type { PlayConfirmStatus, PlayStatus } from "./morning-confirm-verdict";

export type MorningStatusEditionPlay = {
  rank: number;
  ticker: string;
  direction: string;
};

export type MorningStatusOutcomeRow = {
  ticker: string;
  morning_verdict?: Record<string, unknown> | null;
};

const VALID_STATUSES = new Set<PlayConfirmStatus>([
  "CONFIRMED",
  "DEGRADED",
  "INVALIDATED",
  "UNVERIFIED",
]);

function asConfirmStatus(raw: string): PlayConfirmStatus {
  const up = raw.toUpperCase();
  return VALID_STATUSES.has(up as PlayConfirmStatus) ? (up as PlayConfirmStatus) : "UNVERIFIED";
}

/**
 * Reconstruct a MorningConfirmResult from durable outcome-row pins. Returns null when
 * no play on the edition carries a readable morning_verdict (honest "not yet run").
 */
export function morningStatusFromDb(opts: {
  editionFor: string;
  editionPlays: MorningStatusEditionPlay[];
  outcomeRows: MorningStatusOutcomeRow[];
}): MorningConfirmResult | null {
  const verdictByTicker = new Map<string, ReturnType<typeof readNighthawkMorningVerdict>>();
  for (const row of opts.outcomeRows) {
    const verdict = readNighthawkMorningVerdict(row.morning_verdict ?? null);
    if (verdict) verdictByTicker.set(row.ticker.toUpperCase(), verdict);
  }
  if (verdictByTicker.size === 0) return null;

  const plays: PlayStatus[] = [];
  let checkedAt: string | null = null;
  let spxPremarket: number | null = null;
  let priorClose: number | null = null;
  let gapPts: number | null = null;
  let regime: string | null = null;

  for (const ep of opts.editionPlays) {
    const tk = ep.ticker.toUpperCase();
    const verdict = verdictByTicker.get(tk);
    if (!verdict) continue;

    if (verdict.checked_at) {
      if (!checkedAt || verdict.checked_at < checkedAt) checkedAt = verdict.checked_at;
    }
    const metrics = verdict.metrics;
    if (metrics) {
      if (spxPremarket == null && metrics.spx_premarket != null) spxPremarket = metrics.spx_premarket;
      if (priorClose == null && metrics.spx_prior_close != null) priorClose = metrics.spx_prior_close;
      if (gapPts == null && metrics.overnight_gap_pts != null) gapPts = metrics.overnight_gap_pts;
      if (regime == null && metrics.regime != null) regime = metrics.regime;
    }

    plays.push({
      rank: ep.rank,
      ticker: tk,
      direction: ep.direction,
      status: asConfirmStatus(verdict.status),
      reason: verdict.reason ?? "",
      checked_at: verdict.checked_at,
    });
  }

  if (plays.length === 0) return null;

  const summary = {
    confirmed: plays.filter((p) => p.status === "CONFIRMED").length,
    degraded: plays.filter((p) => p.status === "DEGRADED").length,
    invalidated: plays.filter((p) => p.status === "INVALIDATED").length,
    unverified: plays.filter((p) => p.status === "UNVERIFIED").length,
  };

  return {
    edition_for: opts.editionFor,
    checked_at: checkedAt ?? plays[0]?.checked_at ?? new Date(0).toISOString(),
    spx_premarket: spxPremarket,
    prior_close: priorClose,
    overnight_gap_pts: gapPts,
    regime,
    gex_bias: null,
    call_wall: null,
    put_wall: null,
    plays,
    summary,
  };
}
