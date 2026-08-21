import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";
import { buildZeroDteRecord } from "@/lib/zerodte/record";

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

// Mutable so a test can supply banger rows: `mock.module` is applied once at module load, so the
// fixture has to be reachable through a reference rather than baked into the mock's return value.
let BANGER_ROWS: Array<Record<string, unknown>> = [];

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLogRange: async () => ROWS,
    fetchLatestSwingSnapshotEvents: async () => [],
    fetchOpenSwingPositions: async () => [],
    fetchRecentHelixSignalOutcomes: async () => [],
  },
});

// product-reads imports these from "@/lib/banger/positions-db", NOT from "../db" — the two
// entries that used to sit in the ../db mock above were never applied, so `bangerBoardForLargo`
// went to the real (unreachable) database, returned available:false, and the session-anchor test
// below took its `if (r.available === false) return` escape hatch and asserted nothing. A guard
// that cannot fail is not a guard.
mock.module("../banger/positions-db", {
  namedExports: {
    fetchBangerBoardRows: async () => BANGER_ROWS,
    fetchBangerOpenCount: async () => BANGER_ROWS.filter((r) => r.status === "OPEN" || r.status === "PARTIAL").length,
  },
});

let bangerBoardForLargo: typeof import("./product-reads").bangerBoardForLargo;
let nighthawkHorizonsForLargo: typeof import("./product-reads").nighthawkHorizonsForLargo;
let zerodteRecordForLargo: typeof import("./product-reads").zerodteRecordForLargo;
let thermalCompareRow: typeof import("./product-reads").thermalCompareRow;
let etSessionNow: typeof import("./product-reads").etSessionNow;
let ageSecondsFrom: typeof import("./product-reads").ageSecondsFrom;

before(async () => {
  ({
    bangerBoardForLargo,
    nighthawkHorizonsForLargo,
    zerodteRecordForLargo,
    thermalCompareRow,
    etSessionNow,
    ageSecondsFrom,
  } = await import("./product-reads"));
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

// A bare UTC `as_of` reads a full session ahead between ~20:00 ET and midnight. Both of
// these payloads are session-scoped — banger rows are keyed by session_date, and the 0DTE
// counts answer "how many are open TODAY" — so the session has to be stated, not inferred.
describe("session anchors (Largo product contract C1)", () => {
  it("banger board states its ET session alongside the UTC instant", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "1";
    try {
      const r = (await bangerBoardForLargo()) as Record<string, unknown>;
      // Was `if (r.available === false) return`, which — with the banger fetchers now genuinely
      // mocked — is the branch this guard must never take again.
      assert.equal(r.available, true, "the board must be reachable for this guard to mean anything");
      assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.match(String(r.session_date), /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(String(r.as_of_et).slice(0, 10), r.session_date);
    } finally {
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });

  it("nighthawk horizons states its ET session alongside the UTC instant", async () => {
    const r = (await nighthawkHorizonsForLargo()) as Record<string, unknown>;
    assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(String(r.session_date), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(String(r.as_of_et), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/);
    assert.equal(String(r.as_of_et).slice(0, 10), r.session_date);
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

// Edge states the record must answer honestly rather than degrade into a fabricated number:
// pre-open, a holiday, a session the fail-closed firewall held entirely, and a session still
// in flight where every play is open. The load-bearing assertion is win_rate_pct === null —
// a 0% win rate would be a fact the data does not contain.
describe("zerodteRecordForLargo — empty and ungraded windows", () => {
  it("an empty window reports null rates, never a fabricated 0%", () => {
    const rec = buildZeroDteRecord([], { since: "2026-08-14", through: "2026-08-21", days: 7 });
    assert.equal(rec.total_flagged, 0);
    assert.equal(rec.graded, 0);
    assert.equal(rec.available, false);
    assert.equal(rec.win_rate_pct, null, "0% would claim a measurement the window does not contain");
    assert.equal(rec.mechanical.win_rate_pct, null);
  });

  it("a session where every play is still open reports them unGRADED, not as losses", () => {
    const held = [1, 2, 3].map((i) => ({
      session_date: "2026-08-21", ticker: `T${i}`, direction: "long",
      first_flagged_at: "2026-08-21T14:00:00.000Z", score_max: 60, conviction: "B",
      plan_outcome: null, plan_pnl_pct: null, direction_hit: null, move_pct: null,
      entry_context: null, status: "OPEN",
    })) as unknown as Parameters<typeof buildZeroDteRecord>[0];
    const rec = buildZeroDteRecord(held, { since: "2026-08-14", through: "2026-08-21", days: 7 });
    assert.equal(rec.total_flagged, 3);
    assert.equal(rec.ungraded, 3);
    assert.equal(rec.graded, 0);
    assert.equal(rec.losses, 0, "an ungraded play is not a loss");
    assert.equal(rec.win_rate_pct, null);
  });
});

// The number Largo quotes for a CLOSED banger must be the one the member's own board shows.
// Measured on the live board 2026-08-21, all eight closed rows disagreed with their recorded
// realized figure and every one understated it — WRBY realized +32.69% against a mark-derived
// -33.8%, a sign flip on a winner.
describe("bangerBoardForLargo — a closed position reports what it realized", () => {
  const wrby = {
    id: 1, ticker: "WRBY", session_date: "2026-08-20", contract_strike: 25, contract_expiry: "2026-08-22",
    entry_premium: 0.65, last_mark: 0.43, peak_premium: 1.3, scaled_already: true,
    scale_out_action: "CLOSE_RUNNER", scale_out_reason: "trail", realized_pnl_pct: 32.69,
    discovery_gain: 0.4, status: "CLOSED_RUNNER",
  };

  it("quotes the recorded realized figure and never a mark-derived stand-in", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "1";
    BANGER_ROWS = [wrby];
    try {
      const r = (await bangerBoardForLargo()) as Record<string, unknown>;
      const closed = (r.closed as Array<Record<string, unknown>>)[0];
      assert.equal(closed.realized_pnl_pct, 32.69);
      assert.equal(closed.pnl_basis, "realized_as_managed");
      assert.equal(closed.live_pnl_pct, undefined, '"live" on a closed position is a lie');
      assert.match(String(closed.pnl_note), /banked tranche/);
      assert.equal(closed.scaled_already, true);
    } finally {
      BANGER_ROWS = [];
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });

  it("states that its closed tally is page-limited rather than passing it off as a total", async () => {
    const prev = process.env.BANGER_ENGINE_ENABLED;
    process.env.BANGER_ENGINE_ENABLED = "1";
    BANGER_ROWS = [wrby];
    try {
      const r = (await bangerBoardForLargo()) as Record<string, unknown>;
      assert.equal(r.closed_count_is_page_limited, true);
      assert.equal(r.closed_shown, 1);
    } finally {
      BANGER_ROWS = [];
      if (prev === undefined) delete process.env.BANGER_ENGINE_ENABLED;
      else process.env.BANGER_ENGINE_ENABLED = prev;
    }
  });
});

describe("thermalCompareRow — a reading carries the session it belongs to", () => {
  // Live capture 2026-08-21T00:29Z (20:29 ET): the served spot is EXACTLY SPY's 16:00 ET
  // close, four and a half hours old, under an envelope stamp that reads as "now".
  const MATRIX_ASOF = "2026-08-21T00:24:56.192Z";
  const LIVE_SPY = {
    // Live near-term set for SPY, 2026-08-21 — the scope the aggregate below was summed over.
    near_term_expiries: ["2026-08-21", "2026-08-24", "2026-08-25", "2026-09-18"],
    spot: 762.6,
    change_pct: 0.31,
    asof: MATRIX_ASOF,
    flip: null,
    call_wall: 780,
    put_wall: 765,
    net_gex: -1_234_567,
    gamma_regime_read: "short gamma: momentum / vol expansion. Resistance 780, support 765.",
    gex_cross_validation: null,
  };

  it("carries the matrix asof and its age, not only the tool-run stamp", () => {
    const now = Date.parse("2026-08-21T00:29:56.192Z");
    const row = thermalCompareRow("SPY", LIVE_SPY, now);
    assert.equal(row.available, true);
    assert.equal(row.spot, 762.6);
    // The regression: matrix_asof used to be dropped entirely.
    assert.equal(row.matrix_asof, MATRIX_ASOF);
    assert.equal(row.matrix_age_sec, 300);
  });

  it("anchors the matrix time to its ET SESSION, not just a UTC instant", () => {
    const row = thermalCompareRow("SPY", LIVE_SPY, Date.parse("2026-08-21T00:29:56.192Z"));
    // MATRIX_ASOF is 2026-08-21T00:24Z — a UTC date one day AHEAD of the ET session it belongs to.
    assert.equal(row.matrix_asof, "2026-08-21T00:24:56.192Z");
    assert.equal(row.matrix_session_date, "2026-08-20", "ET session, not the UTC date");
    assert.match(String(row.matrix_asof_et), / ET$/);
  });

  it("says the gamma read is CACHED, separately from how old the computation is", () => {
    const row = thermalCompareRow("SPY", LIVE_SPY, Date.parse("2026-08-21T00:29:56.192Z"));
    // freshness must not be inferable from age: 300s of COMPUTE age over a 4.5h-old print.
    assert.equal(row.freshness, "cached");
    assert.equal(row.matrix_age_sec, 300);
    assert.equal(row.unavailable, null);
  });

  it("reports nulls — never a borrowed timestamp — when the matrix is cold, and says why", () => {
    const row = thermalCompareRow("NVDA", null);
    assert.equal(row.available, false);
    assert.equal(row.spot, null);
    assert.equal(row.matrix_asof, null);
    assert.equal(row.matrix_asof_et, null);
    assert.equal(row.matrix_session_date, null);
    assert.equal(row.matrix_age_sec, null);
    assert.equal(row.freshness, null);
    // A wall of nulls with no reason makes a reader guess; name the state instead.
    assert.match(String(row.unavailable?.reason), /matrix cold/i);
    assert.equal(row.unavailable?.retryable, true);
  });
});

describe("etSessionNow / ageSecondsFrom", () => {
  it("names the session for a weekday RTH instant", () => {
    // 2026-08-20 is a Thursday; 14:30Z = 10:30 ET.
    assert.equal(etSessionNow(new Date("2026-08-20T14:30:00Z")).phase, "OPEN");
  });

  it("does not call a closed-market instant OPEN", () => {
    // 00:29Z on the 21st = 20:29 ET on the 20th — the exact instant measured live, at which
    // the payload served SPY's 16:00 close under an `as_of` of "now". AFTER-HOURS ends at
    // 20:00 ET, so this instant is CLOSED outright.
    const s = etSessionNow(new Date("2026-08-21T00:29:00Z"));
    assert.equal(s.phase, "CLOSED");
    assert.equal(s.et_time, "20:29 ET");
  });

  it("names the after-hours window between 16:00 and 20:00 ET", () => {
    assert.equal(etSessionNow(new Date("2026-08-20T21:30:00Z")).phase, "AFTER-HOURS"); // 17:30 ET
  });

  it("calls the weekend CLOSED", () => {
    // 2026-08-22 is a Saturday.
    assert.equal(etSessionNow(new Date("2026-08-22T14:30:00Z")).phase, "CLOSED");
  });

  it("returns null for an unusable stamp rather than a fabricated age", () => {
    assert.equal(ageSecondsFrom(null), null);
    assert.equal(ageSecondsFrom("not-a-date"), null);
    assert.equal(ageSecondsFrom("2026-08-21T00:24:56.192Z", Date.parse("2026-08-21T00:25:56.192Z")), 60);
  });
});

describe("thermalCompareRow — a multi-expiry aggregate names its scope", () => {
  const LIVE_SPY_SCOPED = {
    near_term_expiries: ["2026-09-18", "2026-08-21", "2026-08-25"],
    spot: 762.6,
    change_pct: 0.31,
    asof: "2026-08-21T00:24:56.192Z",
    flip: null,
    call_wall: 780,
    put_wall: 765,
    net_gex: -10_984_439_955.55,
    gamma_regime_read: "No gamma flip — dealers are net short gamma at EVERY strike.",
    gex_cross_validation: null,
  };

  it("carries the count and date range the numbers were summed over", () => {
    const row = thermalCompareRow("SPY", LIVE_SPY_SCOPED) as {
      expiry_scope: { count: number; first: string; last: string } | null;
    };
    // Measured 2026-08-21: this aggregate said "short, flip null" while /heatmap scoped to one
    // expiry said "LONG GAMMA, flip 756". Both correct; unreconcilable without the scope.
    assert.deepEqual(row.expiry_scope, {
      count: 3,
      first: "2026-08-21",
      last: "2026-09-18",
    });
  });

  it("sorts the range rather than trusting upstream order", () => {
    // The input above is deliberately out of order — first/last must be the real extremes.
    const row = thermalCompareRow("SPY", LIVE_SPY_SCOPED) as {
      expiry_scope: { first: string; last: string } | null;
    };
    assert.equal(row.expiry_scope?.first, "2026-08-21");
    assert.equal(row.expiry_scope?.last, "2026-09-18");
  });

  it("reports a null scope rather than an empty shape when the matrix has no expiry list", () => {
    const noList = thermalCompareRow("SPY", { ...LIVE_SPY_SCOPED, near_term_expiries: undefined }) as {
      expiry_scope: unknown;
    };
    assert.equal(noList.expiry_scope, null);
    const cold = thermalCompareRow("NVDA", null) as { expiry_scope: unknown };
    assert.equal(cold.expiry_scope, null);

  });
});
