import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeBangerScaleOut } from "./banger-track-record";

const row = (edition_for: string, ticker: string, blob: Record<string, unknown> | null) => ({
  edition_for,
  ticker,
  scale_out_grade: blob,
});
const grade = (real: number | null, hold: number | null, ungradeable = false) => ({
  scale_out_realized_mult: real,
  hold_mult: hold,
  ungradeable,
});

test("insufficient data (<10 gradeable) → insufficient_data verdict, but still reports the track record", () => {
  const s = summarizeBangerScaleOut([
    row("2026-07-01", "NVDA", grade(2.4, 1.1)),
    row("2026-07-02", "AMD", grade(1.8, 0.9)),
    row("2026-07-03", "SOFI", grade(null, null, true)), // ungradeable — excluded from the rate
  ]);
  assert.equal(s.recommendation.verdict, "insufficient_data");
  assert.equal(s.n_total, 3);
  assert.equal(s.n_gradeable, 2);
  assert.equal(s.n_ungradeable, 1);
  assert.equal(s.green_rate_pct, 100); // both gradeable came out > 1×
});

test("n>=10 gradeable clearing the EV bar → enforce; ungradeable rows never imputed", () => {
  const graded = [];
  for (let i = 0; i < 11; i++) graded.push(row(`2026-07-${String(i + 1).padStart(2, "0")}`, `T${i}`, grade(2.2, 1.0)));
  graded.push(row("2026-07-20", "THIN", grade(null, null, true)));
  const s = summarizeBangerScaleOut(graded);
  assert.equal(s.recommendation.verdict, "enforce");
  assert.equal(s.n_gradeable, 11);
  assert.equal(s.n_ungradeable, 1);
  assert.equal(s.mean_realized_mult, 2.2);
  assert.equal(s.mean_hold_mult, 1.0);
});

test("n>=10 but the scale-out does NOT beat hold enough → keep_calibrating", () => {
  const graded = [];
  for (let i = 0; i < 10; i++) graded.push(row(`2026-07-${String(i + 1).padStart(2, "0")}`, `T${i}`, grade(1.05, 1.0)));
  const s = summarizeBangerScaleOut(graded);
  assert.equal(s.recommendation.verdict, "keep_calibrating"); // +0.05× < 0.15× bar
});

test("a malformed/unparseable blob is treated as ungradeable, never counted as a grade", () => {
  const s = summarizeBangerScaleOut([
    row("2026-07-01", "NVDA", grade(2.0, 1.0)),
    row("2026-07-02", "JUNK", { not_a_grade: true }),
    row("2026-07-03", "NULLED", null),
  ]);
  assert.equal(s.n_gradeable, 1);
  assert.equal(s.n_ungradeable, 2);
});

test("rows are returned most-recent-first for the surface", () => {
  const s = summarizeBangerScaleOut([
    row("2026-07-01", "A", grade(2, 1)),
    row("2026-07-05", "B", grade(2, 1)),
    row("2026-07-03", "C", grade(2, 1)),
  ]);
  assert.deepEqual(s.rows.map((r) => r.edition_for), ["2026-07-05", "2026-07-03", "2026-07-01"]);
});
