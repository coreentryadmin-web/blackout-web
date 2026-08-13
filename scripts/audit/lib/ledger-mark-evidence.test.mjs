import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSeededMark,
  orderLedgerRowsForMarkCheck,
  classifyMarkEvidence,
} from './ledger-mark-evidence.mjs';

/** The real ARM row from the 2026-08-13 board — the false positive that motivated all of this. */
const ARM = {
  ticker: 'ARM',
  entry_premium: 6.95,
  last_mark: 6.95,
  last_mark_at: null,
  peak_premium: 10.33,
  trough_premium: 6.95,
  exit_reason: 'ratchet',
};

test('isSeededMark flags only rows whose mark is bit-identical to entry', () => {
  assert.equal(isSeededMark(ARM), true);
  assert.equal(isSeededMark({ entry_premium: 5.4, last_mark: 4.75 }), false);
  // Nulls are never "seeded" — there is nothing to compare.
  assert.equal(isSeededMark({ entry_premium: 5.4, last_mark: null }), false);
  assert.equal(isSeededMark({ entry_premium: null, last_mark: 5.4 }), false);
  assert.equal(isSeededMark({}), false);
});

test('orderLedgerRowsForMarkCheck puts seeded-mark rows first so a capped sample cannot miss them', () => {
  // This is the regression that mattered: with the cap at 5, ARM sat at index 7 in board order
  // and three consecutive runs reported "0 FAIL" without ever looking at it.
  const boardOrder = [
    { ticker: 'TSLA', entry_premium: 5.4, last_mark: 4.75 },
    { ticker: 'SNXX', entry_premium: 0.57, last_mark: 0.68 },
    { ticker: 'MUU', entry_premium: 1.08, last_mark: 2.23 },
    { ticker: 'ACHR', entry_premium: 0.16, last_mark: 0.12 },
    { ticker: 'AMD', entry_premium: 2.0, last_mark: 1.1 },
    { ticker: 'NVDA', entry_premium: 3.0, last_mark: 4.4 },
    { ticker: 'META', entry_premium: 8.0, last_mark: 9.1 },
    ARM,
  ];
  const ordered = orderLedgerRowsForMarkCheck(boardOrder);
  assert.equal(ordered[0].ticker, 'ARM');
  assert.ok(ordered.slice(0, 5).some((r) => r.ticker === 'ARM'), 'ARM must survive a cap of 5');
  assert.equal(ordered.length, boardOrder.length, 'no rows dropped');
});

test('orderLedgerRowsForMarkCheck is stable within buckets and does not mutate its input', () => {
  const rows = [
    { ticker: 'A', entry_premium: 1, last_mark: 2 },
    { ticker: 'B', entry_premium: 1, last_mark: 1 },
    { ticker: 'C', entry_premium: 1, last_mark: 3 },
    { ticker: 'D', entry_premium: 1, last_mark: 1 },
  ];
  const snapshot = rows.map((r) => r.ticker);
  const ordered = orderLedgerRowsForMarkCheck(rows);
  assert.deepEqual(ordered.map((r) => r.ticker), ['B', 'D', 'A', 'C']);
  assert.deepEqual(rows.map((r) => r.ticker), snapshot, 'input array untouched');
});

test('orderLedgerRowsForMarkCheck tolerates empty/absent input', () => {
  assert.deepEqual(orderLedgerRowsForMarkCheck([]), []);
  assert.deepEqual(orderLedgerRowsForMarkCheck(undefined), []);
});

test('classifyMarkEvidence: a stamped last_mark_at is exact proof', () => {
  const ev = classifyMarkEvidence({ entry_premium: 6.95, last_mark: 6.95, last_mark_at: '2026-08-13T18:00:00Z' });
  assert.equal(ev.kind, 'mark_at');
  assert.equal(ev.mark_at, '2026-08-13T18:00:00Z');
});

test('classifyMarkEvidence: a mark that moved off entry proves a quote landed', () => {
  const ev = classifyMarkEvidence({ entry_premium: 5.4, last_mark: 4.75, last_mark_at: null });
  assert.equal(ev.kind, 'differs');
});

test('classifyMarkEvidence: ARM (breakeven ratchet) is lane_wrote, NOT a frozen mark', () => {
  const ev = classifyMarkEvidence(ARM);
  assert.equal(ev.kind, 'lane_wrote');
  assert.equal(ev.peak_premium, 10.33);
  assert.equal(ev.exit_reason, 'ratchet');
});

test('classifyMarkEvidence: a trough away from entry is as conclusive as a peak', () => {
  // Same lane writes both, so a position that only ever went AGAINST the holder is equally proven.
  const ev = classifyMarkEvidence({ entry_premium: 2.0, last_mark: 2.0, last_mark_at: null, peak_premium: 2.0, trough_premium: 0.9 });
  assert.equal(ev.kind, 'lane_wrote');
});

test('classifyMarkEvidence: genuinely frozen row still falls through to the tape test', () => {
  // The RIOT 2026-08-11 shape: nothing but the seeded entry anywhere. peak/trough equal to entry
  // is exactly what a never-written row looks like, so this MUST NOT be excused as lane_wrote.
  const ev = classifyMarkEvidence({ entry_premium: 0.93, last_mark: 0.93, last_mark_at: null, peak_premium: 0.93, trough_premium: 0.93 });
  assert.equal(ev.kind, 'tape_needed');
});

test('classifyMarkEvidence: missing peak/trough columns do not excuse a frozen mark', () => {
  const ev = classifyMarkEvidence({ entry_premium: 0.93, last_mark: 0.93, last_mark_at: null });
  assert.equal(ev.kind, 'tape_needed');
});

test('classifyMarkEvidence: no mark at all is not judged', () => {
  assert.equal(classifyMarkEvidence({ entry_premium: 1.0, last_mark: null }).kind, 'no_mark');
  assert.equal(classifyMarkEvidence({}).kind, 'no_mark');
});
