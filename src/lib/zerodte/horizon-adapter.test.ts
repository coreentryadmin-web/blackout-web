import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zeroDteSetupToHorizonPlay,
  zeroDteSetupsToHorizonPlays,
} from "./horizon-adapter.ts";
import type { EnrichedZeroDteSetup } from "./board.ts";

/** Minimal enriched-setup stand-in — only the fields the adapter reads; cast like the sibling tests. */
function setup(over: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "nvda",
    direction: "long",
    top_strike: 145,
    expiry: "2026-07-23",
    dte: 0,
    score: 78,
    gate: null,
    plan: null,
    ...over,
  } as unknown as EnrichedZeroDteSetup;
}

test("maps direction/strike/expiry into a uniform ZERO_DTE HorizonPlay contract", () => {
  const play = zeroDteSetupToHorizonPlay(setup({ direction: "long", top_strike: 145 }));
  assert.ok(play);
  assert.equal(play!.horizon, "ZERO_DTE");
  assert.equal(play!.direction, "LONG");
  assert.equal(play!.contract.right, "C");
  assert.equal(play!.contract.strike, 145);
  assert.equal(play!.contract.expiry, "2026-07-23");
  assert.equal(play!.ticker, "NVDA"); // upper-cased
  assert.equal(play!.scoreFloor, 65);
});

test("SHORT setup buys puts", () => {
  const play = zeroDteSetupToHorizonPlay(setup({ direction: "short" }));
  assert.equal(play!.direction, "SHORT");
  assert.equal(play!.contract.right, "P");
});

test("commit decision comes from the engine's gate verdict, not a re-threshold", () => {
  // A blocked gate is WATCH even with a high score — mirrors the 0DTE Command board.
  const blocked = zeroDteSetupToHorizonPlay(
    setup({ score: 95, gate: { verdict: "SKIP", blocks: [] } as never }),
  );
  assert.equal(blocked!.status, "WATCH", "a gate-blocked setup must not be silently promoted to COMMIT");
  const committed = zeroDteSetupToHorizonPlay(
    setup({ score: 66, gate: { verdict: "COMMIT", blocks: [] } as never }),
  );
  assert.equal(committed!.status, "COMMIT");
});

test("a persisted live status (OPEN/HOLD/TRIM) reads as COMMIT even when the gate context has aged out", () => {
  const s = setup({ score: 40, gate: null }); // below floor, no fresh gate
  assert.equal(zeroDteSetupToHorizonPlay(s, "HOLD")!.status, "COMMIT");
  assert.equal(zeroDteSetupToHorizonPlay(s, "OPEN")!.status, "COMMIT");
  assert.equal(zeroDteSetupToHorizonPlay(s, "CLOSED")!.status, "WATCH"); // closed is not a working play
});

test("no gate context → falls back to the lane floor on the committed score", () => {
  assert.equal(zeroDteSetupToHorizonPlay(setup({ score: 70, gate: null }))!.status, "COMMIT"); // ≥ 65
  assert.equal(zeroDteSetupToHorizonPlay(setup({ score: 64, gate: null }))!.status, "WATCH"); // < 65
});

test("pricing comes from the live plan; mid prefers the mark, else the bid/ask midpoint", () => {
  const withMark = zeroDteSetupToHorizonPlay(
    setup({ plan: { bid: 4.0, ask: 4.4, mark: 4.2, entry_max: 4.2 } as never }),
  );
  assert.equal(withMark!.contract.bid, 4.0);
  assert.equal(withMark!.contract.ask, 4.4);
  assert.equal(withMark!.contract.mid, 4.2); // the mark
  assert.ok(withMark!.reason.includes("entry ≤ $4.20"));
  // No mark → midpoint of bid/ask.
  const noMark = zeroDteSetupToHorizonPlay(
    setup({ plan: { bid: 3.0, ask: 3.4, mark: null, entry_max: null } as never }),
  );
  assert.equal(noMark!.contract.mid, 3.2);
});

test("a setup with no top strike can't be expressed as a contract → dropped", () => {
  assert.equal(zeroDteSetupToHorizonPlay(setup({ top_strike: null })), null);
});

test("zeroDteSetupsToHorizonPlays sorts by score desc and drops the contractless", () => {
  const plays = zeroDteSetupsToHorizonPlays([
    setup({ ticker: "AAA", score: 70 }),
    setup({ ticker: "BBB", score: 90 }),
    setup({ ticker: "CCC", score: 80, top_strike: null }), // dropped
  ]);
  assert.deepEqual(plays.map((p) => p.ticker), ["BBB", "AAA"]);
});

test("persisted-status map keys by upper-cased ticker", () => {
  const plays = zeroDteSetupsToHorizonPlays(
    [setup({ ticker: "spy", score: 30, gate: null })],
    new Map([["SPY", "OPEN"]]),
  );
  assert.equal(plays[0]!.status, "COMMIT");
});
