/**
 * Lightweight mark/close loop for swing_shadow_positions (deep-dive Q33–Q34).
 *
 * Shadow rows record candidates blocked by risk gates. Without ongoing marks and a terminal
 * close+grade, they cannot feed calibration evidence. This module mirrors the real book's
 * premium/structural-stop discipline at reduced scope — no rolls, no manage-sync, no member board.
 */
import type { SwingShadowPositionRow } from "@/lib/db";
import { dteOf } from "@/lib/zerodte/scan-trigger";

export type ShadowRefreshReads = {
  underlyingPrice: number | null;
  mark: number | null;
  dte: number | null;
  nowMs: number;
};

export type ShadowCloseReason = "expiry" | "structural_stop" | "premium_stop";

export type ShadowCloseDecision = {
  close: boolean;
  reason: ShadowCloseReason | null;
  detail: string;
};

/** Premium return % from entry — same sign convention as roll-plan gradeParentFromMark. */
export function shadowRealizedPnlPct(entryPremium: number, exitMark: number): number {
  if (!Number.isFinite(entryPremium) || entryPremium <= 0 || !Number.isFinite(exitMark)) return 0;
  return Number((((exitMark - entryPremium) / entryPremium) * 100).toFixed(4));
}

function dirLc(direction: "long" | "short"): "LONG" | "SHORT" {
  return direction === "short" ? "SHORT" : "LONG";
}

/** Direction-aware structural stop — mirrors manage.ts structuralStopBroken. */
export function shadowStructuralStopBroken(
  direction: "long" | "short",
  underlyingPrice: number | null,
  stopLevel: number | null,
): { broken: boolean; reason: string } {
  if (underlyingPrice == null || stopLevel == null) {
    return { broken: false, reason: "no underlying / stop — not evaluable" };
  }
  const dir = dirLc(direction);
  if (dir === "LONG" && underlyingPrice <= stopLevel) {
    return { broken: true, reason: `underlying ${underlyingPrice} ≤ stop ${stopLevel}` };
  }
  if (dir === "SHORT" && underlyingPrice >= stopLevel) {
    return { broken: true, reason: `underlying ${underlyingPrice} ≥ stop ${stopLevel}` };
  }
  return { broken: false, reason: "structural stop holding" };
}

/** −60% capital backstop — mirrors manage.ts premium_stop gate (pre-scale). */
export function shadowPremiumStopHit(
  entryPremium: number | null,
  mark: number | null,
): { hit: boolean; reason: string } {
  if (entryPremium == null || entryPremium <= 0 || mark == null || !Number.isFinite(mark)) {
    return { hit: false, reason: "premium not evaluable" };
  }
  if (mark <= entryPremium * 0.4) {
    return { hit: true, reason: `mark ${mark} ≤ 40% of entry ${entryPremium} (−60% backstop)` };
  }
  return { hit: false, reason: "premium above backstop" };
}

type ShadowContractFields = Pick<
  SwingShadowPositionRow,
  "contract_type" | "contract_strike"
>;

/**
 * Intrinsic option value at expiry (per-share premium units). Returns 0 for OTM expiry.
 * Used so shadow grading does not close expired OTM legs at a stale last mark.
 */
export function shadowIntrinsicMarkAtExpiry(
  row: ShadowContractFields,
  underlyingPrice: number | null,
): number | null {
  if (underlyingPrice == null || !Number.isFinite(underlyingPrice)) return null;
  const strike = row.contract_strike;
  if (strike == null || !Number.isFinite(strike)) return null;
  const type = String(row.contract_type ?? "").toLowerCase();
  let intrinsic = 0;
  if (type === "call") intrinsic = Math.max(0, underlyingPrice - strike);
  else if (type === "put") intrinsic = Math.max(0, strike - underlyingPrice);
  else return null;
  return Number(intrinsic.toFixed(4));
}

/** Decide whether an OPEN shadow should close this tick. Priority: expiry → structural → premium. */
export function decideShadowClose(
  row: SwingShadowPositionRow,
  reads: ShadowRefreshReads,
): ShadowCloseDecision {
  const dte =
    reads.dte ??
    (row.contract_expiry ? dteOf(row.contract_expiry, reads.nowMs) : null);
  if (dte != null && dte < 0) {
    return { close: true, reason: "expiry", detail: `contract expired (dte=${dte})` };
  }

  const structural = shadowStructuralStopBroken(
    row.direction,
    reads.underlyingPrice,
    row.thesis_invalidation_px ?? null,
  );
  if (structural.broken) {
    return { close: true, reason: "structural_stop", detail: structural.reason };
  }

  const mark = reads.mark ?? row.last_mark;
  const premium = shadowPremiumStopHit(row.entry_premium ?? null, mark);
  if (premium.hit) {
    return { close: true, reason: "premium_stop", detail: premium.reason };
  }

  return { close: false, reason: null, detail: "holding" };
}

export type ShadowRefreshDeps = {
  fetchOpen: () => Promise<SwingShadowPositionRow[]>;
  loadReads: (row: SwingShadowPositionRow) => Promise<ShadowRefreshReads | null>;
  updateMarks: (
    id: number,
    update: { mark: number; peakPremium: number; troughPremium: number },
  ) => Promise<number>;
  closeAndGrade: (
    id: number,
    grade: { realized_pnl_pct: number; close_reason: ShadowCloseReason; close_detail: string },
  ) => Promise<number>;
  /** Max shadows to touch per pass — bounded so real-book refresh stays primary. */
  limit?: number;
};

export type ShadowRefreshResult = {
  shadows: number;
  marked: number;
  closed: number;
  skipped: number;
  errored: number;
};

/** One bounded pass over OPEN shadow rows: latch marks, close+grade terminals. Fail-soft per row. */
export async function runSwingShadowRefresh(deps: ShadowRefreshDeps): Promise<ShadowRefreshResult> {
  const limit = deps.limit ?? 25;
  const rows = (await deps.fetchOpen()).slice(0, limit);
  let marked = 0;
  let closed = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of rows) {
    try {
      const reads = await deps.loadReads(row);
      if (!reads) {
        skipped += 1;
        continue;
      }

      const mark = reads.mark;
      if (mark != null && Number.isFinite(mark) && mark > 0) {
        const peak = Math.max(row.peak_premium ?? row.entry_premium ?? mark, mark);
        const trough = Math.min(row.trough_premium ?? row.entry_premium ?? mark, mark);
        const touched = await deps.updateMarks(row.id, { mark, peakPremium: peak, troughPremium: trough });
        if (touched > 0) marked += 1;
      }

      const decision = decideShadowClose(row, { ...reads, mark: mark ?? row.last_mark });
      if (!decision.close || decision.reason == null) continue;

      const entry = row.entry_premium;
      const exitMark =
        decision.reason === "expiry"
          ? (shadowIntrinsicMarkAtExpiry(row, reads.underlyingPrice) ??
            mark ??
            row.last_mark ??
            entry)
          : (mark ?? row.last_mark ?? entry);
      if (entry == null || exitMark == null || !Number.isFinite(exitMark)) {
        skipped += 1;
        continue;
      }

      const touched = await deps.closeAndGrade(row.id, {
        realized_pnl_pct: shadowRealizedPnlPct(entry, exitMark),
        close_reason: decision.reason,
        close_detail: decision.detail,
      });
      if (touched > 0) closed += 1;
    } catch {
      errored += 1;
    }
  }

  return { shadows: rows.length, marked, closed, skipped, errored };
}
