import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayLegacyQuotes } from "./use-legacy-quotes";
import type { TerminalPlay } from "./types";

function basePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "p1",
    ticker: "TEST",
    direction: "LONG",
    contract: "TEST stock",
    score: 42,
    status: "WATCH",
    horizon: "LEGACY",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "BUY",
    ...overrides,
  } as TerminalPlay;
}

function quote(price: number, extra: Partial<{ changePct: number; asof: string; sessionHigh: number; sessionLow: number }> = {}) {
  return {
    price,
    changePct: extra.changePct ?? 0,
    asof: extra.asof ?? "2026-09-15T11:00:00Z",
    sessionHigh: extra.sessionHigh ?? price,
    sessionLow: extra.sessionLow ?? price,
  };
}

const LONG_ORIG = { ticker: "TEST", target: "8.41", stop: "6.64", entry_range: "$7.46-$7.84" };
const SHORT_ORIG = { ticker: "TEST", target: "6.64", stop: "8.41", entry_range: "$7.46-$7.84" };

test("overlayLegacyQuotes: no quotes -> plays returned unchanged (same reference)", () => {
  const plays = [basePlay()];
  const result = overlayLegacyQuotes(plays, new Map(), [LONG_ORIG]);
  assert.equal(result, plays);
});

test("overlayLegacyQuotes: ticker missing from quotes map -> play passed through unchanged", () => {
  const plays = [basePlay()];
  const quotes = new Map([["OTHER", quote(10)]]);
  const result = overlayLegacyQuotes(plays, quotes, [LONG_ORIG]);
  assert.equal(result[0], plays[0]);
});

test("overlayLegacyQuotes: unparseable entry_range -> only markAsOf stamped, no progress/stockMovePct", () => {
  const plays = [basePlay()];
  const quotes = new Map([["TEST", quote(7.5, { asof: "T1" })]]);
  const result = overlayLegacyQuotes(plays, quotes, [{ ticker: "TEST", target: "8.41", stop: "6.64", entry_range: null }]);
  assert.equal(result[0].markAsOf, "T1");
  assert.equal(result[0].progress, undefined);
  assert.equal(result[0].stockMovePct, undefined);
});

test("overlayLegacyQuotes LONG: progress is 0-1 along the [stop, target] range, clamped at both ends", () => {
  const plays = [basePlay({ direction: "LONG" })];

  // Exactly at stop -> 0
  let r = overlayLegacyQuotes(plays, new Map([["TEST", quote(6.64)]]), [LONG_ORIG]);
  assert.equal(r[0].progress, 0);

  // Exactly at target -> 1
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote(8.41)]]), [LONG_ORIG]);
  assert.equal(r[0].progress, 1);

  // Below stop -> clamped to 0, not negative
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote(5)]]), [LONG_ORIG]);
  assert.equal(r[0].progress, 0);

  // Above target -> clamped to 1
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote(20)]]), [LONG_ORIG]);
  assert.equal(r[0].progress, 1);

  // Midpoint of [stop, target] -> 0.5
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote((6.64 + 8.41) / 2)]]), [LONG_ORIG]);
  assert.ok(Math.abs((r[0].progress ?? -1) - 0.5) < 1e-9);
});

test("overlayLegacyQuotes LONG: a price still BELOW the entry band (unfilled, drifting toward stop) " +
  "reads as a nonzero progress fraction -- progress is anchored to [stop, target], NOT [entry, target]. " +
  "Documents the real, live-observed VNCE 2026-09-15 shape (see knownOpenItems.legacyTargetPathGaugeAmbiguity_2026-09-15 " +
  "in the audit journal): entry band $7.46-$7.84, price $7.27 is below the whole entry band yet still " +
  "reads ~35% progress because it is well above the $6.64 stop.", () => {
  const plays = [basePlay({ direction: "LONG" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(7.27)]]), [LONG_ORIG]);
  const expected = (7.27 - 6.64) / (8.41 - 6.64);
  assert.ok(Math.abs((r[0].progress ?? -1) - expected) < 1e-9, `expected ~${expected}, got ${r[0].progress}`);
  assert.ok((r[0].progress ?? 0) > 0.3, "progress should read a meaningful nonzero fraction despite price being outside the entry band");
});

test("overlayLegacyQuotes SHORT: progress direction mirrors LONG (stop above, target below)", () => {
  const plays = [basePlay({ direction: "SHORT" })];

  // At stop (above) -> 0
  let r = overlayLegacyQuotes(plays, new Map([["TEST", quote(8.41)]]), [SHORT_ORIG]);
  assert.equal(r[0].progress, 0);

  // At target (below) -> 1
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote(6.64)]]), [SHORT_ORIG]);
  assert.equal(r[0].progress, 1);

  // Beyond stop (higher than stop) -> clamped to 0
  r = overlayLegacyQuotes(plays, new Map([["TEST", quote(20)]]), [SHORT_ORIG]);
  assert.equal(r[0].progress, 0);
});

test("overlayLegacyQuotes: target === stop -> progress stays null (no divide-by-zero garbage)", () => {
  const plays = [basePlay({ direction: "LONG" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(7.5)]]), [
    { ticker: "TEST", target: "7.00", stop: "7.00", entry_range: "$7.46-$7.84" },
  ]);
  assert.equal(r[0].progress, null);
});

test("overlayLegacyQuotes LONG: stockMovePct is signed with the underlying's move from the entry-band MIDPOINT, " +
  "never the option's P&L -- pnlPct/peak/trough are always nulled out (fail-closed, see the file's own " +
  "MU-$880C comment)", () => {
  const plays = [basePlay({ direction: "LONG", pnlPct: 999, peak: 999, trough: 999 } as Partial<TerminalPlay>)];
  const entryMid = (7.46 + 7.84) / 2; // 7.65
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(7.8)]]), [LONG_ORIG]);
  const expectedMove = ((7.8 - entryMid) / entryMid) * 100;
  assert.ok(Math.abs((r[0].stockMovePct ?? -999) - expectedMove) < 0.01);
  assert.ok((r[0].stockMovePct ?? 0) > 0, "price above entry mid on a LONG should show a positive stock move");
  assert.equal(r[0].pnlPct, null);
  assert.equal(r[0].peak, null);
  assert.equal(r[0].trough, null);
});

test("overlayLegacyQuotes SHORT: stockMovePct sign is flipped relative to LONG for the same price move", () => {
  const plays = [basePlay({ direction: "SHORT" })];
  // Price below entry mid is FAVORABLE for a SHORT -> positive stockMovePct.
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(7.0)]]), [SHORT_ORIG]);
  assert.ok((r[0].stockMovePct ?? 0) > 0, "price falling below entry mid on a SHORT should show a positive (favorable) stock move");
});

test("overlayLegacyQuotes LONG: price AT the stop overrides recommendation to SELL with a stop-level note", () => {
  const plays = [basePlay({ direction: "LONG", status: "OPEN", recommendation: "HOLD" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(6.64)]]), [LONG_ORIG]);
  assert.equal(r[0].recommendation, "SELL");
  assert.match(r[0].recNote ?? "", /stop level/i);
});

test("overlayLegacyQuotes LONG: price AT the target overrides recommendation to TRIM with a target note", () => {
  const plays = [basePlay({ direction: "LONG", status: "OPEN", recommendation: "HOLD" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(8.41)]]), [LONG_ORIG]);
  assert.equal(r[0].recommendation, "TRIM");
  assert.match(r[0].recNote ?? "", /target/i);
});

test("overlayLegacyQuotes SHORT: price AT the stop (above entry, moving against the short) overrides to SELL", () => {
  const plays = [basePlay({ direction: "SHORT", status: "OPEN", recommendation: "HOLD" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(8.41)]]), [SHORT_ORIG]);
  assert.equal(r[0].recommendation, "SELL");
});

test("overlayLegacyQuotes: a CLOSED play never gets its recommendation overridden even past stop/target", () => {
  const plays = [basePlay({ direction: "LONG", status: "CLOSED", recommendation: "HOLD" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(6.0)]]), [LONG_ORIG]);
  assert.equal(r[0].recommendation, "HOLD");
});

test("overlayLegacyQuotes: a SKIPped play never gets its recommendation overridden even past stop/target", () => {
  const plays = [basePlay({ direction: "LONG", status: "SKIP", recommendation: "HOLD" })];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(20)]]), [LONG_ORIG]);
  assert.equal(r[0].recommendation, "HOLD");
});

test("overlayLegacyQuotes LONG: stockPeakPct/stockTroughPct derive from session high/low on the entry-mid basis", () => {
  const plays = [basePlay({ direction: "LONG" })];
  const entryMid = (7.46 + 7.84) / 2;
  const r = overlayLegacyQuotes(
    plays,
    new Map([["TEST", quote(7.7, { sessionHigh: 8.0, sessionLow: 7.2 })]]),
    [LONG_ORIG]
  );
  const expectedPeak = ((8.0 - entryMid) / entryMid) * 100;
  const expectedTrough = ((7.2 - entryMid) / entryMid) * 100;
  assert.ok(Math.abs((r[0].stockPeakPct ?? -999) - expectedPeak) < 0.01);
  assert.ok(Math.abs((r[0].stockTroughPct ?? -999) - expectedTrough) < 0.01);
});

test("overlayLegacyQuotes: stockPrice/stockChangePct/markAsOf are always stamped from the quote when present", () => {
  const plays = [basePlay()];
  const r = overlayLegacyQuotes(plays, new Map([["TEST", quote(7.7, { changePct: 1.23, asof: "T-abc" })]]), [LONG_ORIG]);
  assert.equal(r[0].stockPrice, 7.7);
  assert.equal(r[0].stockChangePct, 1.23);
  assert.equal(r[0].markAsOf, "T-abc");
});
