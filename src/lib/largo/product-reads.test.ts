import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";

mock.module("server-only", { namedExports: {} });

/** A realistically FAT ledger row.
 *
 *  `entry_context` is what made `get_zerodte_record` undeliverable: in prod it runs
 *  ~5.3KB per play (cortex snapshot, tier factors, origin maps, exit-policy snapshot)
 *  and accounted for 984,898 of the tool's 1,052,064 chars. The fixture reproduces
 *  that weight so the budget assertion below is testing the real failure mode rather
 *  than a toy payload that would fit no matter what the reader did. */
function fatRow(i: number) {
  const day = String(3 + (i % 20)).padStart(2, "0");
  return {
    session_date: `2026-08-${day}`,
    ticker: `TK${String(i).padStart(3, "0")}`,
    direction: i % 2 === 0 ? "long" : "short",
    first_flagged_at: `2026-08-${day}T14:${String(10 + (i % 40)).padStart(2, "0")}:00.000Z`,
    score_max: 40 + (i % 55),
    conviction: "B",
    plan_outcome: i % 3 === 0 ? "doubled" : i % 3 === 1 ? "stopped" : "time_stop",
    plan_pnl_pct: i % 3 === 0 ? 54.4 : i % 3 === 1 ? -50 : -3.6,
    direction_hit: i % 2 === 0,
    move_pct: 0.4,
    top_strike: 100 + i,
    entry_premium: 2.5,
    status: "CLOSED",
    entry_context: {
      cortex: { verdict: "commit", sources: Array.from({ length: 8 }, (_, k) => ({ name: `src${k}`, score: k, detail: "x".repeat(120) })) },
      tier: { tier: "B", factors: Array.from({ length: 6 }, (_, k) => ({ f: `factor${k}`, v: k, why: "y".repeat(60) })) },
      exit_policy_snapshot: { policy: "trim_scale", trim_levels: [0.3, 0.6, 1.0], runner_fraction: 0.34, pad: "z".repeat(200) },
      origin_maps: { origin_direction_map: { FLOW: "long" }, origin_score_map: { FLOW: 70 } },
      regime_plane: { confidence: "high", gexQuality: "polygon_chain", vixDayOpen: 14.91 },
    },
  };
}

const ROWS = Array.from({ length: 182 }, (_, i) => fatRow(i));

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLogRange: async () => ROWS,
    fetchBangerBoardRows: async () => [],
    fetchBangerOpenCount: async () => 0,
    fetchLatestSwingSnapshotEvents: async () => [],
    fetchOpenSwingPositions: async () => [],
    fetchRecentHelixSignalOutcomes: async () => [],
  },
});

let bangerBoardForLargo: typeof import("./product-reads").bangerBoardForLargo;
let zerodteRecordForLargo: typeof import("./product-reads").zerodteRecordForLargo;

before(async () => {
  ({ bangerBoardForLargo, zerodteRecordForLargo } = await import("./product-reads"));
});

describe("product-reads", () => {
  it("bangerBoardForLargo returns disabled when engine flag off", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "0";
    try {
      const result = await bangerBoardForLargo();
      assert.equal(result.available, false);
      assert.equal(result.enabled, false);
    } finally {
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });
});

describe("zerodteRecordForLargo — deliverable to the model", () => {
  it("fits inside the transport's per-tool_result cap", async () => {
    const chars = JSON.stringify(await zerodteRecordForLargo(30)).length;
    assert.ok(
      chars < MAX_TOOL_RESULT_CHARS,
      `record is ${chars} chars, transport cap is ${MAX_TOOL_RESULT_CHARS} — it would be tail-truncated`
    );
  });

  it("carries every headline aggregate (the fields the tail cut used to eat)", async () => {
    const r = (await zerodteRecordForLargo(30)) as Record<string, unknown>;
    // These are exactly the keys that sat behind ~1MB of plays[] in prod and never
    // arrived. If any of them goes missing again, the track-record tool has no record.
    for (const key of [
      "total_flagged", "graded", "ungraded", "wins", "losses", "breakeven",
      "win_rate_pct", "avg_pnl_pct", "by_outcome", "by_time_of_day",
      "by_direction", "by_score_band", "mechanical", "available", "methodology", "window",
    ]) {
      assert.ok(key in r, `missing aggregate: ${key}`);
    }
    assert.equal(r.total_flagged, 182);
    assert.ok(typeof r.win_rate_pct === "number", "win_rate_pct must be a real number");
  });

  it("aggregates are serialized BEFORE plays, so any future tail cut eats the sample", async () => {
    const raw = JSON.stringify(await zerodteRecordForLargo(30));
    assert.ok(
      raw.indexOf('"win_rate_pct"') < raw.indexOf('"plays":'),
      "win_rate_pct must precede plays[] — key order is what decides survival under a tail cut"
    );
    assert.ok(raw.indexOf('"mechanical"') < raw.indexOf('"plays":'));
  });

  it("samples plays and says so — a short list must never read as the whole ledger", async () => {
    const r = (await zerodteRecordForLargo(30)) as Record<string, unknown>;
    const plays = r.plays as unknown[];
    assert.ok(plays.length > 0, "a sample of zero would answer nothing");
    assert.ok(plays.length < 182, "182 fat plays cannot fit — this must be a sample");
    assert.equal(r.plays_total, 182, "the model must be told the TRUE total");
    assert.equal(r.plays_included, plays.length);
    assert.match(String(r.plays_note), /182/);
    assert.match(String(r.plays_note), /SAMPLE/i);
  });

  it("drops the entry_context forensics blob that was 94% of the payload", async () => {
    const r = (await zerodteRecordForLargo(30)) as Record<string, unknown>;
    for (const p of r.plays as Array<Record<string, unknown>>) {
      assert.ok(!("entry_context" in p), "entry_context must not ride the model's copy");
    }
    // …but the fields a member actually asks about must survive the slimming.
    const first = (r.plays as Array<Record<string, unknown>>)[0];
    for (const key of ["session_date", "ticker", "direction", "managed_outcome", "managed_pnl_pct"]) {
      assert.ok(key in first, `lean play lost a member-facing field: ${key}`);
    }
  });

  it("still fits at the widest window the tool allows (days=90)", async () => {
    const chars = JSON.stringify(await zerodteRecordForLargo(90)).length;
    assert.ok(chars < MAX_TOOL_RESULT_CHARS, `days=90 record is ${chars} chars`);
  });
});
