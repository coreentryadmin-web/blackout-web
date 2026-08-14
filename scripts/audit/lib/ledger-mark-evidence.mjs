// Pure helpers for the 0DTE ledger "was a quote EVER observed on this row?" check in
// data-validator.mjs. Extracted so the two decisions that check gets wrong-or-right — WHICH rows
// it looks at, and WHAT counts as proof the mark lane wrote a row — are unit-testable without a
// live board, Clerk session, or Polygon key.

/**
 * Coerce to a finite number, else null. Note the explicit null/'' guard: `Number(null)` and
 * `Number('')` are both 0, so without it a row with NO premium at all reads as a premium of
 * exactly zero — which is precisely the "bit-identical" comparison this module turns on.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Bit-identical within float slop. */
const EQ = 1e-9;

/**
 * True when a row's last_mark is still bit-identical to its seeded entry_premium — the frozen
 * SIGNATURE, and the entire population the frozen-mark check exists to interrogate.
 */
export function isSeededMark(row) {
  const lm = num(row?.last_mark);
  const ep = num(row?.entry_premium);
  return lm != null && ep != null && Math.abs(lm - ep) < EQ;
}

/**
 * Order ledger rows so the suspicious ones (last_mark === entry_premium) are checked FIRST.
 *
 * WHY: the per-run row cap is a COST control — each row costs Polygon minute-bar fetches — but
 * slicing raw board order turned it into a COVERAGE lottery. Board order changes between runs, so
 * on 2026-08-13 the ARM row was audited at 15:57 and then silently skipped at 19:33, 20:33 and
 * 23:xx: three consecutive runs reported "0 FAIL" while the row under suspicion was simply not
 * looked at. A suite that rotates its sample can stop reporting a standing defect without anything
 * changing, which is worse than not checking at all — it reads as all-clear.
 *
 * The sort is STABLE within each bucket (Array#sort is stable per spec), so board order is
 * preserved among equally-interesting rows and the run stays deterministic for a given board.
 */
export function orderLedgerRowsForMarkCheck(rows) {
  return [...(rows || [])].sort((a, b) => (isSeededMark(a) ? 0 : 1) - (isSeededMark(b) ? 0 : 1));
}

/**
 * Classify the evidence that a real quote landed on a ledger row, WITHOUT touching the tape.
 *
 * Returns one of:
 *  - `no_mark`        — no last_mark at all; nothing to judge.
 *  - `mark_at`        — last_mark_at is stamped, which db.ts only does on a real quote. Exact.
 *  - `differs`        — pre-column row whose mark moved off entry: a quote clearly landed.
 *  - `lane_wrote`     — mark === entry, BUT peak_premium/trough_premium differ from entry.
 *  - `tape_needed`    — mark === entry and nothing else distinguishes it; the caller must settle
 *                       it against Polygon minute bars.
 *
 * `lane_wrote` is the case this check was missing. peak_premium/trough_premium are latched by the
 * SAME mark lane that writes last_mark (live-marks.ts), so a peak or trough that differs from
 * entry is exactly as conclusive as a last_mark that differs — the lane demonstrably wrote to this
 * row. Without it, a breakeven-RATCHET exit is misread as a frozen mark: the position runs up, the
 * ratchet trails the stop to entry, and the row closes at precisely entry_premium, making
 * last_mark === entry a REAL observed value rather than a seeded one. ARM on 2026-08-13 was exactly
 * that — entry 6.95, peak 10.33 (+48.6%), exit_reason=ratchet, last_mark 6.95 — and it was reported
 * as a P1 "manufactured P&L" for six hours, because the tape test cannot tell "never written" from
 * "written, and equal to entry".
 */
export function classifyMarkEvidence(row) {
  const lm = num(row?.last_mark);
  if (lm == null) return { kind: 'no_mark' };

  const ep = num(row?.entry_premium);
  const markAt = row?.last_mark_at ?? null;
  if (markAt != null) return { kind: 'mark_at', last_mark: lm, mark_at: markAt };

  if (!isSeededMark(row)) return { kind: 'differs', last_mark: lm, entry_premium: ep };

  const peak = num(row?.peak_premium);
  const trough = num(row?.trough_premium);
  const laneWrote =
    ep != null &&
    ((peak != null && Math.abs(peak - ep) > EQ) || (trough != null && Math.abs(trough - ep) > EQ));
  if (laneWrote) {
    return {
      kind: 'lane_wrote',
      last_mark: lm,
      entry_premium: ep,
      peak_premium: peak,
      trough_premium: trough,
      exit_reason: row?.exit_reason ?? null,
    };
  }

  return { kind: 'tape_needed', last_mark: lm, entry_premium: ep };
}
