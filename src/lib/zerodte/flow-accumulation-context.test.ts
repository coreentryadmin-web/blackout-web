import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flowRowsToAlertRows,
  accumulationSignalsFromFlow,
  isAligned,
  toFlowAccumulationContext,
  attachFlowAccumulation,
  type MinimalFlowRow,
} from "./flow-accumulation-context";
import type { EnrichedZeroDteSetup } from "./board";

const NOW = Date.parse("2026-07-22T17:00:00Z"); // ~13:00 ET
const DAY = 86_400_000;
const iso = (d: number) => new Date(NOW - d * DAY).toISOString();

function flow(over: Partial<MinimalFlowRow> = {}): MinimalFlowRow {
  return {
    ticker: "NVDA",
    premium: 1_000_000,
    option_type: "CALL",
    strike: 900,
    expiry: "2026-07-24",
    ask_pct: 90, // aggressive buyer
    alert_rule: "RepeatedHitsSweep",
    alerted_at: iso(0),
    ...over,
  };
}

test("ask_pct reconstructs the aggressor split (ask-side = premium × ask_pct)", () => {
  const [row] = flowRowsToAlertRows([flow({ premium: 1_000_000, ask_pct: 90 })]);
  assert.ok(row, "row maps");
  assert.equal(row.askSidePremium, 900_000);
  assert.equal(row.bidSidePremium, 100_000);
  assert.equal(row.side, "call");
  assert.equal(row.sweep, true, "sweep inferred from alert_rule");
});

test("missing ask_pct → null split (engine falls back to half-weight)", () => {
  const [row] = flowRowsToAlertRows([flow({ ask_pct: null })]);
  assert.equal(row.askSidePremium, null);
  assert.equal(row.bidSidePremium, null);
});

test("malformed rows are dropped (no side / no premium / no strike / no time)", () => {
  const rows = flowRowsToAlertRows([
    flow({ option_type: "" }),
    flow({ premium: 0 }),
    flow({ strike: 0 }),
    flow({ alerted_at: null, event_at: null }),
    flow(), // the one good row
  ]);
  assert.equal(rows.length, 1);
});

test("alignment: long confirmed by multi-day calls, short fights it", () => {
  assert.equal(isAligned("long", "bull"), true);
  assert.equal(isAligned("short", "bull"), false);
  assert.equal(isAligned("short", "bear"), true);
  assert.equal(isAligned("long", "neutral"), null);
});

test("end-to-end: a 3-day ask-side call build reads bull, and a long setup is aligned", () => {
  const rows = [
    flow({ createdAtMs: undefined, alerted_at: iso(0) }),
    flow({ alerted_at: iso(1) }),
    flow({ alerted_at: iso(2) }),
  ];
  const signals = accumulationSignalsFromFlow(rows, NOW);
  const sig = signals.get("NVDA");
  assert.ok(sig, "NVDA signal built");
  assert.equal(sig.direction, "bull");

  const ctx = toFlowAccumulationContext("long", sig);
  assert.equal(ctx.direction, "bull");
  assert.equal(ctx.aligned, true);
  assert.equal(ctx.magnet_strike, 900);
  assert.equal(ctx.magnet_side, "call");
  assert.ok(ctx.days >= 3, "magnet built over ≥3 distinct days");
});

test("attachFlowAccumulation sets context on matches and null on misses", () => {
  const signals = accumulationSignalsFromFlow([flow({ alerted_at: iso(0) }), flow({ alerted_at: iso(1) })], NOW);
  const setups = [
    { ticker: "NVDA", direction: "long" },
    { ticker: "ZZZZ", direction: "short" },
  ] as unknown as EnrichedZeroDteSetup[];
  attachFlowAccumulation(setups, signals);
  assert.ok(setups[0].flow_accumulation, "NVDA got a context");
  assert.equal(setups[0].flow_accumulation?.direction, "bull");
  assert.equal(setups[1].flow_accumulation, null, "unknown ticker → explicit null");
});
