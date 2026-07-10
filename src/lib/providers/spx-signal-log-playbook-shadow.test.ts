import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

// spx-signal-log.ts (the module under test) statically imports the ecosystem shadow
// factor, whose fetchEcosystemContext -> getSpxPlayState chain (bie/ecosystem-context.ts
// -> platform/spx-service.ts -> spx-play-engine.ts) pulls in a real `import "server-only"`
// several hops deep. Stub it the same way every other spx-signal-log-*.test.ts sibling
// does, or a plain `node --test` load crashes at import time — this file never exercises
// that chain directly, so an empty stub is enough.
mock.module("server-only", { namedExports: {} });

// logPlaybookShadowMatch (this file's module under test, src/features/spx/lib/
// spx-signal-log.ts) is the fire-and-forget wiring called from evaluateSpxPlay right
// after the real computeSpxConfluence() (src/features/spx/lib/spx-play-engine.ts),
// sibling to logSpxShadowFactors covered in spx-signal-log-shadow.test.ts. Unlike every
// other shadow-factor wiring function in this file, it does NOT fetch anything itself —
// `desk`/`technicals` are already computed by the caller and handed straight to the pure
// matchPlaybooksShadow (src/features/spx/lib/playbook-shadow-matcher.ts, unit-tested on
// its own in playbook-shadow-matcher.test.ts and left REAL here) — so this test only
// needs to verify the DB-not-configured short-circuit and the persisted row shape/count,
// not any provider fallback behavior.
//
// Same DB-mocking convention as every spx-signal-log-*.test.ts sibling (mock "@/lib/db"
// from the consumer under test, not the "pg" package — see spx-signal-log-shadow.test.ts's
// own header comment for why a real "pg" mock doesn't work under this project's
// tsx + --experimental-test-module-mocks runner).

const state = {
  dbConfigured: true,
  inserted: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.dbConfigured = true;
  state.inserted = [];
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async () => ({ rows: [], rowCount: 0 }),
    getMeta: async () => null,
    setMeta: async () => {},
    insertSpxSignalLog: async () => {},
    insertShadowFactorObservation: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
  },
});
mock.module("./spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-07-09",
  },
});

// Lazy import (ESM caches the module under test after the first call) so the mocks above
// are in place before spx-signal-log.ts's own top-level imports resolve.
const mod = () => import("../../features/spx/lib/spx-signal-log");

function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    price: 7420,
    vwap: 7400,
    above_vwap: true,
    hod: 7430,
    lod: 7390,
    gamma_flip: 7410,
    above_gamma_flip: true,
    gamma_regime: "amplification",
    flow_0dte_net: null,
    regime: "bullish",
    ...overrides,
  } as SpxDeskPayload;
}

function technicalsStub(overrides: Partial<PlayTechnicals> = {}): PlayTechnicals {
  return {
    available: true,
    price: 7420,
    m1_bars: 100,
    m3_close: 7420,
    m5_close: 7420,
    m5_ema20: 7415,
    m5_rsi: 55,
    m5_rsi_warning: null,
    m5_trend: "flat",
    m3_above_vwap: true,
    breakout: {
      pdh_break: false,
      pdl_break: false,
      hod_break: false,
      lod_break: false,
      vwap_reclaim: false,
      vwap_lost: false,
    },
    mtf: {
      m3_confirms_long: null,
      m3_confirms_short: null,
      m5_confirms_long: false,
      m5_confirms_short: false,
    },
    or_high: null,
    or_low: null,
    or_defined: false,
    or_minutes: 20,
    minutes_below_vwap: 0,
    minutes_above_vwap: 0,
    m3_consecutive_closes_above_vwap: 0,
    m3_consecutive_closes_below_vwap: 0,
    m1_ema9: null,
    ema9_curling_toward_vwap: null,
    ...overrides,
  } as PlayTechnicals;
}

test("logPlaybookShadowMatch: db not configured — zero inserts", async () => {
  const { logPlaybookShadowMatch } = await mod();
  resetState();
  state.dbConfigured = false;

  await logPlaybookShadowMatch(deskStub(), technicalsStub(), { score: 42, grade: "B" });

  assert.equal(state.inserted.length, 0);
});

test("logPlaybookShadowMatch: persists exactly one row per registry playbook (3 total), each carrying the real score/grade/price", async () => {
  const { logPlaybookShadowMatch } = await mod();
  resetState();

  await logPlaybookShadowMatch(deskStub({ price: 7420 }), technicalsStub(), { score: 55, grade: "A" });

  assert.equal(state.inserted.length, 3);
  const factorNames = state.inserted.map((r) => r.factor_name).sort();
  assert.deepEqual(factorNames, ["playbook_pb_01_match", "playbook_pb_02_match", "playbook_pb_03_match"]);
  for (const row of state.inserted) {
    assert.equal(row.available, true);
    assert.equal(row.implied_weight, 0);
    assert.equal(row.price_at_observation, 7420);
    assert.equal(row.actual_score, 55);
    assert.equal(row.actual_grade, "A");
    assert.equal(row.session_date, "2026-07-09");
  }
});

test("logPlaybookShadowMatch: a triggered playbook persists direction bullish/bearish (mapped from long/short) and marks itself primary in detail", async () => {
  const { logPlaybookShadowMatch } = await mod();
  resetState();

  // 11:00 ET on 2026-07-09 (EDT, UTC-4) — inside PB-01's window; above_vwap:false +
  // vwap_reclaim:true fires PB-01 long (see playbook-shadow-matcher.test.ts for the
  // exhaustive pure-function coverage of this exact scenario).
  const now = Date.parse("2026-07-09T15:00:00.000Z");
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await logPlaybookShadowMatch(
      deskStub({ above_vwap: false, vwap: 7380, price: 7383, flow_0dte_net: 500_000 }),
      technicalsStub({
        m3_close: 7383,
        breakout: {
          pdh_break: false,
          pdl_break: false,
          hod_break: false,
          lod_break: false,
          vwap_reclaim: true,
          vwap_lost: false,
        },
      }),
      { score: 61, grade: "B" }
    );
  } finally {
    Date.now = originalNow;
  }

  const pb01Row = state.inserted.find((r) => r.factor_name === "playbook_pb_01_match")!;
  assert.equal(pb01Row.direction, "bullish");
  assert.match(String(pb01Row.detail), /trigger=true/);
  assert.match(String(pb01Row.detail), /primary=true/);

  const pb02Row = state.inserted.find((r) => r.factor_name === "playbook_pb_02_match")!;
  assert.equal(pb02Row.direction, "neutral");
  assert.match(String(pb02Row.detail), /primary=false/);
});
