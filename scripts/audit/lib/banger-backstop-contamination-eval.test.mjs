import { test } from "node:test";
import assert from "node:assert/strict";
import { flagBackstopQuoteContamination, contaminationDeltaShare } from "./banger-backstop-contamination-eval.mjs";

function row(overrides) {
  return {
    id: 1,
    ticker: "TEST",
    session_date: "2026-08-04",
    entry_premium: 0.5,
    peak_premium: 1.0,
    scale_out_action: "EXIT_RUNNER",
    realized_pnl_pct: 50,
    ...overrides,
  };
}

test("flagBackstopQuoteContamination: an ordinary shared-peak-with-plausible-return group is NOT flagged", () => {
  // 3 unrelated tickers share peak=2.85 but with modest entries -> peakPct well under 500%.
  const rows = [
    row({ id: 1, ticker: "AAA", entry_premium: 2.0, peak_premium: 2.85 }), // 42.5%
    row({ id: 2, ticker: "BBB", entry_premium: 2.2, peak_premium: 2.85 }), // 29.5%
    row({ id: 3, ticker: "CCC", entry_premium: 2.5, peak_premium: 2.85 }), // 14%
  ];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 0);
});

test("flagBackstopQuoteContamination: a genuinely outsized SOLO winner (peak not shared) is NOT flagged", () => {
  const rows = [
    row({ id: 1, ticker: "SOLO", entry_premium: 0.05, peak_premium: 5.0 }), // 9900% but UNIQUE peak
    row({ id: 2, ticker: "OTHER1", entry_premium: 1.0, peak_premium: 1.2 }),
    row({ id: 3, ticker: "OTHER2", entry_premium: 1.0, peak_premium: 1.3 }),
  ];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 0);
});

test("flagBackstopQuoteContamination: peak shared by >=3 distinct tickers AND implausible peakPct -> flagged (the real CRSR/EBS/CPRI/PAGS shape)", () => {
  const rows = [
    row({ id: 1, ticker: "CRSR", session_date: "2026-08-04", entry_premium: 0.07, peak_premium: 7.5 }), // ~10614%
    row({ id: 2, ticker: "EBS", session_date: "2026-08-04", entry_premium: 0.1, peak_premium: 7.5 }),
    row({ id: 3, ticker: "PAGS", session_date: "2026-08-04", entry_premium: 0.04, peak_premium: 7.5 }),
  ];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 3);
  assert.equal(out.beforeFixN, 3);
  assert.equal(out.onOrAfterFixN, 0);
});

test("flagBackstopQuoteContamination: same 2 distinct tickers only (below default minSharedTickers=3) -> NOT flagged", () => {
  const rows = [
    row({ id: 1, ticker: "AAA", entry_premium: 0.05, peak_premium: 7.5 }),
    row({ id: 2, ticker: "BBB", entry_premium: 0.05, peak_premium: 7.5 }),
  ];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 0);
});

test("flagBackstopQuoteContamination: rows on/after the 2026-09-14 fix date are still flaggable but counted separately", () => {
  const rows = [
    row({ id: 1, ticker: "AAA", session_date: "2026-09-20", entry_premium: 0.05, peak_premium: 7.5 }),
    row({ id: 2, ticker: "BBB", session_date: "2026-09-20", entry_premium: 0.05, peak_premium: 7.5 }),
    row({ id: 3, ticker: "CCC", session_date: "2026-09-20", entry_premium: 0.05, peak_premium: 7.5 }),
  ];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 3);
  assert.equal(out.beforeFixN, 0);
  assert.equal(out.onOrAfterFixN, 3);
});

test("flagBackstopQuoteContamination: missing entry/peak is never flagged (absent, not fabricated)", () => {
  const rows = [row({ id: 1, entry_premium: null }), row({ id: 2, peak_premium: null })];
  const out = flagBackstopQuoteContamination(rows);
  assert.equal(out.suspectN, 0);
  assert.equal(out.rows[0]._peakPct, null);
});

test("contaminationDeltaShare: sums delta for suspect ids vs the full population total", () => {
  const tradeRows = [
    { id: 1, cand: { delta: 100 } },
    { id: 2, cand: { delta: 50 } },
    { id: 3, cand: { delta: 10 } },
  ];
  const out = contaminationDeltaShare(tradeRows, "cand", new Set([1, 2]));
  assert.equal(out.totalDelta, 160);
  assert.equal(out.suspectDelta, 150);
  assert.equal(out.sharePct, 93.75);
});
