import { test } from "node:test";
import assert from "node:assert/strict";
import { horizonBoardFromZeroDtePayload } from "./horizon-board-from-payload.ts";
import type { ZeroDteBoardPayload } from "../platform/zerodte-service.ts";
import type { EnrichedZeroDteSetup } from "./board.ts";

function setup(over: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup {
  return {
    ticker: "nvda", direction: "long", top_strike: 145, expiry: "2026-07-23",
    dte: 0, score: 78, gate: { verdict: "COMMIT", blocks: [] }, plan: null, ...over,
  } as unknown as EnrichedZeroDteSetup;
}

function payload(over: Partial<ZeroDteBoardPayload> = {}): ZeroDteBoardPayload {
  return {
    as_of: "2026-07-23T15:00:00Z",
    upstream_ok: true,
    session: { date: "2026-07-23", trading_day: true, heat: {} },
    setups: [],
    ledger: [],
    covered_elsewhere: [],
    governor: null,
    ...over,
  } as unknown as ZeroDteBoardPayload;
}

test("adapts the live 0DTE payload into the ZERO_DTE lane of the unified board", () => {
  const board = horizonBoardFromZeroDtePayload(
    payload({ setups: [setup({ ticker: "AAA", score: 90 }), setup({ ticker: "BBB", score: 70 })] }),
    "2026-07-23T15:00:00Z",
  );
  assert.equal(board.lanes.ZERO_DTE.committedCount, 2); // both COMMIT gate
  assert.deepEqual(board.lanes.ZERO_DTE.committed.map((p) => p.ticker), ["AAA", "BBB"]); // score-sorted
  // The other lanes exist but are empty until whole-market discovery fills them.
  assert.equal(board.lanes.SWING.committedCount, 0);
  assert.equal(board.lanes.LEAPS.committedCount, 0);
});

test("the ledger's live status makes an aged-out working play read as COMMIT", () => {
  const board = horizonBoardFromZeroDtePayload(
    payload({
      setups: [setup({ ticker: "spy", score: 40, gate: null })], // below floor, no fresh gate
      ledger: [{ ticker: "SPY", status: "HOLD" } as never],
    }),
    "2026-07-23T15:00:00Z",
  );
  assert.equal(board.lanes.ZERO_DTE.committed[0]!.ticker, "SPY");
  assert.equal(board.lanes.ZERO_DTE.committed[0]!.status, "COMMIT");
});

test("asOf flows from the payload's as_of", () => {
  const board = horizonBoardFromZeroDtePayload(payload({ as_of: "2026-07-23T09:41:00Z" }), "2026-07-23T09:41:00Z");
  assert.equal(board.asOf, "2026-07-23T09:41:00Z");
});
