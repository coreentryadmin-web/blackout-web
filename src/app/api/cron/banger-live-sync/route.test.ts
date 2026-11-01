import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { occToPositionIds } from "./occ-to-position-ids";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// FINDINGS 2026-10-14 (Ask Largo monitor cycle, live MUZ repro): a plain Map<occ, id> silently
// dropped every id but the last one written when two open positions shared a contract, so only
// one of the two ever got its live bid/ask/greeks/openInterest refreshed — the other was stuck
// with fabricated null/0 forever. occToPositionIds must preserve ALL colliding ids.

test("occToPositionIds: two positions sharing one contract both appear under that occ, not just the last one written", () => {
  const map = occToPositionIds([
    { contract_occ: "O:MUZ261016C00008000", id: 1613 },
    { contract_occ: "O:MUZ261016C00008000", id: 1695 },
  ]);
  assert.deepEqual(map.get("O:MUZ261016C00008000"), [1613, 1695]);
});

test("occToPositionIds: distinct contracts each map to their own single-element id list", () => {
  const map = occToPositionIds([
    { contract_occ: "O:AAPL261016C00200000", id: 10 },
    { contract_occ: "O:MSFT261016C00400000", id: 11 },
  ]);
  assert.deepEqual(map.get("O:AAPL261016C00200000"), [10]);
  assert.deepEqual(map.get("O:MSFT261016C00400000"), [11]);
});

test("occToPositionIds: three positions on the same contract all survive, in insertion order", () => {
  const map = occToPositionIds([
    { contract_occ: "O:SPY261016C00500000", id: 1 },
    { contract_occ: "O:SPY261016C00500000", id: 2 },
    { contract_occ: "O:SPY261016C00500000", id: 3 },
  ]);
  assert.deepEqual(map.get("O:SPY261016C00500000"), [1, 2, 3]);
});

test("occToPositionIds: an occ with no rows is simply absent from the map", () => {
  const map = occToPositionIds([{ contract_occ: "O:AAPL261016C00200000", id: 10 }]);
  assert.equal(map.get("O:NOT_PRESENT"), undefined);
});

test("banger-live-sync gates on isEtCashRth before Polygon option-snapshot fetches", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const workAt = routeSrc.indexOf("runBangerLiveSync(");
  assert.ok(authAt >= 0 && gateAt >= 0 && workAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < workAt, "RTH gate must run before live-sync work starts");
});

test("the live quote-fields write loops over every position id sharing an occ, not a single Map value", () => {
  assert.match(
    routeSrc,
    /const positionIds = occToIds\.get\(occ\) \?\? \[\];\s*\n\s*for \(const positionId of positionIds\)/,
    "must iterate every colliding position id for this occ, never just one"
  );
  assert.doesNotMatch(
    routeSrc,
    /occToId\.set\(r\.contract_occ, r\.id\)/,
    "must not regress to the old single-value Map that overwrote colliding ids"
  );
});

test("the prospective quote-tick log persist is fire-and-forget -- never awaited, always .catch()'d, so a write failure cannot affect the real exit-decision path", () => {
  const persistAt = routeSrc.indexOf("persistBangerQuoteTick(");
  assert.ok(persistAt >= 0, "must call persistBangerQuoteTick from the fetchMarks callback");
  const callSite = routeSrc.slice(Math.max(0, persistAt - 40), persistAt + 400);
  assert.match(callSite, /void persistBangerQuoteTick/, "must be fired with `void`, never `await`ed");
  assert.match(callSite, /\.catch\(/, "must attach its own .catch() -- a rejected persist must never surface as an unhandled rejection");
});

// BUG FIX (2026-10-26, Ask Largo x Night Hawk Swings standing mandate — live repro, WEN/ASO/LMND
// positions): `updateBangerQuoteFields` carried `ask: snap.ask` straight off the raw provider
// snapshot while the resolved MARK a few lines above is already guarded against a dead-bid
// backstop-ask artifact via `reliableMarkFromSnapshot` -- the identical gap already found and
// fixed on swing-active-refresh's `loadOptionQuote` (its own route.test.ts carries the mirror of
// this exact test) for the organic-swing live-refresh cron, but never extended to this sibling
// Banger-lane committed-position live-sync cron. The raw ask flows unchanged through
// banger-lane-merge.ts's `horizonPlayFromBangerPosition` into adapters.ts's `liquidityFromContract`
// (`(ask - bid) / mid`), so a guarded (tiny) mark next to an unguarded backstop ask produced a
// nonsensical Spread line (e.g. "10000.0%") on live, committed Banger-origin swing positions.
// Regex-asserted against raw source (matching this file's own convention above for route.ts's
// DB/provider-heavy wiring) -- the guard's own divergence logic is unit-tested directly in
// options-snapshot.test.ts.
test("banger-live-sync's fetchMarks guards the persisted ask through reliableAskFromSnapshot, not the raw snapshot ask", () => {
  assert.match(
    routeSrc,
    /import \{\s*fetchOptionsUnifiedSnapshot,\s*reliableAskFromSnapshot,\s*reliableMarkFromSnapshot,\s*\} from "@\/lib\/providers\/options-snapshot"/,
    "must import the ask-side guard alongside the existing mark-side guard"
  );
  assert.match(
    routeSrc,
    /ask:\s*reliableAskFromSnapshot\(snap\)/,
    "the persisted ask must be resolved through the same divergence guard as the mark, not read raw off snap.ask"
  );
  assert.doesNotMatch(
    routeSrc,
    /ask:\s*snap\.ask,/,
    "the raw, unguarded snap.ask must never be assigned directly into updateBangerQuoteFields again"
  );
});
