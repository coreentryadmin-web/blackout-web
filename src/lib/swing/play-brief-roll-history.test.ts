/**
 * Regression test for the roll-history right-code bug (2026-09-11, live repro INTC:35, the first
 * real rolled-chain closed position to hit production after #4802 shipped): the row→leg mapping
 * passed `row.contract_type` (stored as the full word "call"/"put") straight through as
 * `SwingRollHistoryLeg.right`, but `rollHistoryLine`'s `fmtLeg` (play-brief-narrative.ts) checks
 * the short "P"/"C" code every other reader in this codebase uses (closed-plays.ts, live-plays.ts,
 * play-brief-resolve.ts all do `contract_type === "put" ? "P" : "C"`) — so every rolled leg fell
 * through to the generic "contract" fallback instead of "put"/"call". Live symptom: "Rolled once
 * — most recently from the $91 contract to the $90 contract" instead of "$91 put to the $90 put".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { swingRollHistoryLegFromRow } from "./play-brief-roll-history";

test("swingRollHistoryLegFromRow: converts contract_type 'put' to the short 'P' code every reader expects, not the raw word", () => {
  const leg = swingRollHistoryLegFromRow({
    roll_seq: 1,
    contract_strike: 90,
    contract_type: "put",
    contract_expiry: "2026-09-09",
    committed_at: "2026-09-03T11:00:22.000Z",
  });
  assert.equal(leg.right, "P");
  assert.equal(leg.strike, 90);
  assert.equal(leg.rollSeq, 1);
});

test("swingRollHistoryLegFromRow: converts contract_type 'call' to the short 'C' code", () => {
  const leg = swingRollHistoryLegFromRow({
    roll_seq: 0,
    contract_strike: 110,
    contract_type: "call",
    contract_expiry: "2026-08-18",
    committed_at: "2026-08-20T15:00:00.000Z",
  });
  assert.equal(leg.right, "C");
});
