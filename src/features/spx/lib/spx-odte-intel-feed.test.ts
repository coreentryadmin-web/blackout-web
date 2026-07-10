import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendOdteIntelEvents,
  diffOdteIntelEvents,
  odteIntelEventsToTerminalLines,
  type OdteIntelEvent,
} from "./spx-odte-intel-feed";
import type { SpxDeskPayload } from "./spx-desk";

function desk(partial: Partial<SpxDeskPayload>): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-10T14:00:00.000Z",
    source: "test",
    price: 7540,
    spx_change_pct: 0.5,
    vix: 16,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7500,
    hod: 7560,
    vwap: 7520,
    pdh: null,
    pdl: null,
    prior_close: null,
    gap_pct: null,
    gap_source: null,
    ema20: null,
    ema50: null,
    ema200: null,
    sma50: null,
    sma200: null,
    tick: null,
    trin: null,
    add: null,
    gex_net: 10_000_000_000,
    gex_king: 7550,
    max_pain: 7475,
    gamma_flip: 7489,
    above_gamma_flip: true,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7575, net_gex: 2_000_000_000, kind: "resistance", distance_pts: 35 },
      { strike: 7500, net_gex: -1_500_000_000, kind: "support", distance_pts: 40 },
    ],
    flow_0dte_call_premium: 1_000_000,
    flow_0dte_put_premium: 400_000,
    flow_0dte_net: 600_000,
    spx_flows: [],
    unified_tape: [],
    strike_stacks: [],
    levels: [],
    ...partial,
  } as SpxDeskPayload;
}

test("diffOdteIntelEvents: seed emits anchor + flip + walls + net gex", () => {
  const events = diffOdteIntelEvents(null, desk({}), { seed: true });
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("anchor"));
  assert.ok(kinds.includes("flip"));
  assert.ok(kinds.includes("call_wall"));
  assert.ok(kinds.includes("put_wall"));
  assert.ok(kinds.includes("gex_net"));
  assert.ok(events.every((e) => e.line.text.length > 0));
});

test("diffOdteIntelEvents: anchor migration emits warn line", () => {
  const prev = desk({ gex_king: 7550 });
  const next = desk({ gex_king: 7560, as_of: "2026-07-10T14:01:00.000Z" });
  const events = diffOdteIntelEvents(prev, next);
  const anchor = events.find((e) => e.kind === "anchor");
  assert.ok(anchor);
  assert.match(anchor!.line.text, /ANCHOR migrated/);
  assert.match(anchor!.line.text, /7,?550/);
  assert.match(anchor!.line.text, /7,?560/);
});

test("diffOdteIntelEvents: spot cross above/below flip", () => {
  const prev = desk({ above_gamma_flip: false, price: 7480 });
  const next = desk({ above_gamma_flip: true, price: 7495, as_of: "2026-07-10T14:02:00.000Z" });
  const events = diffOdteIntelEvents(prev, next);
  const cross = events.find((e) => e.kind === "spot_cross");
  assert.ok(cross);
  assert.match(cross!.line.text, /ABOVE/);
});

test("diffOdteIntelEvents: massive flow print only when new", () => {
  const prev = desk({ spx_flows: [] });
  const next = desk({
    as_of: "2026-07-10T14:03:00.000Z",
    spx_flows: [
      {
        ticker: "SPX",
        premium: 1_200_000,
        option_type: "call",
        strike: 7550,
        expiry: "2026-07-10",
        direction: "bullish",
        alerted_at: "2026-07-10T14:02:55.000Z",
        alert_rule: null,
        trade_count: 12,
        has_sweep: true,
      },
    ],
  });
  const events = diffOdteIntelEvents(prev, next);
  const flow = events.find((e) => e.kind === "flow_print");
  assert.ok(flow);
  assert.match(flow!.line.text, /MASSIVE CALL/);
  assert.match(flow!.line.text, /SWEEP/);

  // Same print again → no duplicate
  const again = diffOdteIntelEvents(next, next);
  assert.equal(again.filter((e) => e.kind === "flow_print").length, 0);
});

test("diffOdteIntelEvents: ignores small flow prints", () => {
  const prev = desk({ spx_flows: [] });
  const next = desk({
    as_of: "2026-07-10T14:04:00.000Z",
    spx_flows: [
      {
        ticker: "SPX",
        premium: 50_000,
        option_type: "put",
        strike: 7500,
        expiry: "2026-07-10",
        direction: "bearish",
        alerted_at: "2026-07-10T14:03:55.000Z",
        alert_rule: null,
        trade_count: 2,
        has_sweep: false,
      },
    ],
  });
  const events = diffOdteIntelEvents(prev, next);
  assert.equal(events.filter((e) => e.kind === "flow_print").length, 0);
});

test("appendOdteIntelEvents: dedupes and caps", () => {
  const a: OdteIntelEvent = {
    id: "a",
    at: "t1",
    kind: "anchor",
    line: { icon: "gamma", tone: "accent", text: "A" },
  };
  const b: OdteIntelEvent = {
    id: "b",
    at: "t2",
    kind: "flip",
    line: { icon: "level", tone: "warn", text: "B" },
  };
  const merged = appendOdteIntelEvents([a], [a, b], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
});

test("odteIntelEventsToTerminalLines: empty → listening copy", () => {
  const lines = odteIntelEventsToTerminalLines([]);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /Listening/);
});
