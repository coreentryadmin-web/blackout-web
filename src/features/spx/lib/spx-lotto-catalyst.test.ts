import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLottoCatalysts } from "./spx-lotto-catalyst";
import type { SpxDeskPayload, SpxFlowBrief } from "@/features/spx/lib/spx-desk";

// FIX-1 (parser-truth, gap #6): flowSkew must be THREE-WAY — UNKNOWN/typeless prints
// (option_type='UNKNOWN', direction='unknown') count NEITHER side. They previously fell
// into the bear bucket and produced false SHORT/put-led lotto signals in the LIVE engine.
//
// flowSkew is module-private, so we drive it through the public evaluateLottoCatalysts and
// assert on the emitted "flow" direction_signal. flow_0dte_net stays null so the per-print
// spx_flows tally runs; the default flow floor is $5M (playLottoFlowMinNotional).

function flowBrief(over: Partial<SpxFlowBrief>): SpxFlowBrief {
  return {
    ticker: "SPX",
    premium: 0,
    option_type: "UNKNOWN",
    strike: 5000,
    expiry: "2026-06-24",
    direction: "unknown",
    alerted_at: "2026-06-24T14:00:00Z",
    alert_rule: null,
    trade_count: null,
    has_sweep: false,
    ...over,
  };
}

// Minimal desk — evaluateLottoCatalysts only reads spx_flows / flow_0dte_net / price / a few
// optional structure fields here. Cast through unknown to avoid rebuilding the whole payload.
function desk(spxFlows: SpxFlowBrief[]): SpxDeskPayload {
  return {
    price: 5000,
    prior_close: 5000,
    flow_0dte_net: null,
    spx_flows: spxFlows,
    macro_events: [],
    gex_walls: [],
    dark_pool: null,
  } as unknown as SpxDeskPayload;
}

function flowSignal(d: SpxDeskPayload) {
  return evaluateLottoCatalysts(d).direction_signals.find((s) => s.id === "flow") ?? null;
}

test("flowSkew: all-UNKNOWN tape never produces a short/bear flow signal", () => {
  // $6M of purely typeless premium — over the $5M floor. The OLD binary code bucketed all of
  // it as bear and emitted a SHORT 'put-led tape' signal. Three-way must drop it: no signal.
  const d = desk([
    flowBrief({ premium: 3_000_000, option_type: "UNKNOWN", direction: "unknown" }),
    flowBrief({ premium: 3_000_000, option_type: "UNKNOWN", direction: "unknown" }),
  ]);
  const sig = flowSignal(d);
  assert.equal(sig, null, "typeless tape must not emit a flow direction signal");
});

test("flowSkew: UNKNOWN premium does not flip a call-led tape to short", () => {
  // $6M calls + $4M UNKNOWN. If UNKNOWN counted as bear, bear($4M) vs bull($6M) would still be
  // long, but a larger UNKNOWN block could overturn it. Verify UNKNOWN is simply ignored and
  // the genuine call lead wins.
  const d = desk([
    flowBrief({ premium: 6_000_000, option_type: "C", ask_pct: 75, direction: "bullish" }),
    flowBrief({ premium: 4_000_000, option_type: "UNKNOWN", direction: "unknown" }),
  ]);
  const sig = flowSignal(d);
  assert.ok(sig, "a real call lead should still emit a flow signal");
  assert.equal(sig!.direction, "long", "call-led tape must read long, not short");
});

test("flowSkew: genuine put-led tape still reads short (no regression)", () => {
  // Bought puts (ask_pct >= 60) are bearish. Bought calls (ask_pct >= 60) are bullish.
  // $6M bought puts + $1M bought calls → 6/7 = 85.7% bearish → short.
  const d = desk([
    flowBrief({ premium: 6_000_000, option_type: "P", ask_pct: 75, direction: "bearish" }),
    flowBrief({ premium: 1_000_000, option_type: "C", ask_pct: 75, direction: "bullish" }),
  ]);
  const sig = flowSignal(d);
  assert.ok(sig, "a real put lead should emit a flow signal");
  assert.equal(sig!.direction, "short", "put-led tape must still read short");
});

test("flowSkew: UNKNOWN premium does not count toward the catalyst floor", () => {
  // $4M real calls (below the $5M floor) + $4M UNKNOWN. If UNKNOWN counted, total $8M would
  // clear the floor and emit long. Three-way drops UNKNOWN, so total stays $4M < floor → null.
  const d = desk([
    flowBrief({ premium: 4_000_000, option_type: "C", direction: "bullish" }),
    flowBrief({ premium: 4_000_000, option_type: "UNKNOWN", direction: "unknown" }),
  ]);
  const sig = flowSignal(d);
  assert.equal(sig, null, "UNKNOWN premium must not push a sub-floor tape over the floor");
});

// Regression: a qualifying gap used to be voted TWICE -- once as evaluateLottoCatalysts' own
// independent `id: "gap"` signal, and a second time via `technicalDirection`'s (now-removed) gap
// branch, emitted as `id: "technical"`. Both carried the same direction off the exact same
// underlying evidence (today's gap%), so a single gap print alone could occupy 2 of the 3
// `playLottoMinDirectionSignals()` votes required to qualify a lotto pick.
function gapOnlyDesk(gapPct: number): SpxDeskPayload {
  const priorClose = 5000;
  return {
    price: priorClose * (1 + gapPct / 100),
    prior_close: priorClose,
    flow_0dte_net: null,
    spx_flows: [],
    macro_events: [],
    gex_walls: [],
    dark_pool: null,
  } as unknown as SpxDeskPayload;
}

test("a qualifying gap contributes exactly ONE direction vote, not two", () => {
  // +2.0% gap (>= 3x the 0.4% default floor, so its weight clamps at the 3.0 cap), zero other
  // catalysts.
  const evalResult = evaluateLottoCatalysts(gapOnlyDesk(2.0));
  const gapVotes = evalResult.direction_signals.filter((s) => s.id === "gap");
  const technicalVotes = evalResult.direction_signals.filter((s) => s.id === "technical");
  assert.equal(gapVotes.length, 1, "the gap signal itself should still fire");
  assert.equal(
    technicalVotes.length,
    0,
    "technicalDirection must not ALSO vote off the same gap evidence"
  );
  assert.equal(
    evalResult.direction_signals.length,
    1,
    "one gap print must produce exactly one direction_signal, not two"
  );
});

test("a lone gap can no longer satisfy the 3-vote bar by double-counting itself", () => {
  // Weight bar is satisfied (2.0% gap clamps weight to the 3.0 cap == minWeight), but with only
  // ONE real signal source, the SEPARATE vote-count bar (also default 3) must still fail --
  // before the fix, `technicalDirection`'s duplicate "technical" vote off the same gap evidence
  // would have pushed longVotes to 2, still short of 3, but on a smaller real gap plus one more
  // genuine signal it silently supplied the missing vote. Pinning votes==1 here is the direct
  // regression check; qualified==false is the visible consequence.
  const evalResult = evaluateLottoCatalysts(gapOnlyDesk(2.0));
  assert.equal(evalResult.direction_signals.length, 1);
  assert.equal(evalResult.qualified, false);
  assert.match(evalResult.reason, /need \d\+ agreeing signals/i);
});
