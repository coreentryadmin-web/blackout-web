import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNetFlowWsRow } from "./uw-socket";

test("parseNetFlowWsRow: a row missing BOTH ticker and symbol is dropped, never defaulted to SPX", () => {
  // `net_flow` is joined per-ticker (net_flow:SPX, net_flow:SPY, net_flow:QQQ, net_flow:IWM),
  // but handleMessage discards the wire's own `:TICKER` suffix before dispatch, so a frame
  // relying on that suffix (rather than an explicit field) to convey which ticker it is for
  // is indistinguishable here from any other subscribed ticker. Before the fix, this row
  // would have defaulted to "SPX" and silently overwritten the shared netFlowStore SPX
  // snapshot with what could really be SPY/QQQ/IWM call/put premium.
  const row = { call_premium: 9_000_000, put_premium: 1_000_000, net: 8_000_000 };
  assert.equal(parseNetFlowWsRow(row), null);
});

test("parseNetFlowWsRow: an explicit SPY row is attributed to SPY, not SPX", () => {
  const row = { ticker: "SPY", call_premium: 2_000_000, put_premium: 500_000 };
  const parsed = parseNetFlowWsRow(row);
  assert.ok(parsed);
  assert.equal(parsed!.ticker, "SPY");
  assert.equal(parsed!.call, 2_000_000);
  assert.equal(parsed!.put, 500_000);
  assert.equal(parsed!.net, 1_500_000);
});

test("parseNetFlowWsRow: an explicit SPX row still parses correctly", () => {
  const row = { ticker: "spx", call_premium: 1_000_000, put_premium: 400_000, net: 600_000 };
  const parsed = parseNetFlowWsRow(row);
  assert.deepEqual(parsed, { ticker: "SPX", call: 1_000_000, put: 400_000, net: 600_000 });
});

test("parseNetFlowWsRow: a ticker outside the tracked set is dropped", () => {
  const row = { ticker: "TSLA", call_premium: 5_000_000, put_premium: 0 };
  assert.equal(parseNetFlowWsRow(row), null);
});

test("parseNetFlowWsRow: a status frame / non-object payload is dropped, not crashed on", () => {
  assert.equal(parseNetFlowWsRow(null), null);
  assert.equal(parseNetFlowWsRow("status"), null);
  assert.equal(parseNetFlowWsRow(42), null);
});
