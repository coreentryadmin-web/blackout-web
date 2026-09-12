import { test } from "node:test";
import assert from "node:assert/strict";
import {
  horizonPlayFromBangerPosition,
  horizonPlayFromBangerWatch,
  mergeBangerPositionsIntoSwingPlays,
} from "./banger-lane-merge.ts";
import type { BangerPositionRow } from "../banger/positions-db.ts";
import type { BangerMover } from "../banger/discovery.ts";
import type { HorizonPlay } from "../horizon-plays.ts";

function bangerRow(overrides: Partial<BangerPositionRow> = {}): BangerPositionRow {
  return {
    id: 1,
    commit_key: "2026-09-04:ANET:2026-09-12:150",
    session_date: "2026-09-04",
    ticker: "ANET",
    discovery_gain: 0.12,
    discovery_vol: 2_000_000,
    discovery_dollar_vol: 50_000_000,
    discovery_close_strength: 0.8,
    contract_strike: 150,
    contract_expiry: "2026-09-12",
    contract_occ: "ANET250912C00150000",
    entry_premium: 4.2,
    last_mark: 5.0,
    last_mark_at: "2026-09-04T20:55:00.000Z",
    peak_premium: 5.5,
    scaled_already: false,
    scale_out_action: null,
    scale_out_reason: null,
    partial_realized_premium: null,
    realized_pnl_pct: null,
    realized_pnl_usd: null,
    entry_context: null,
    status: "OPEN",
    first_seen_at: "2026-09-04T20:00:00.000Z",
    committed_at: "2026-09-04T20:05:00.000Z",
    closed_at: null,
    updated_at: "2026-09-04T21:00:00.000Z",
    ...overrides,
  };
}

test("horizonPlayFromBangerPosition maps OPEN banger to SWING MANAGING with BANGER origin", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.horizon, "SWING");
  assert.equal(play!.serving, "MANAGING");
  assert.equal(play!.liveStatus, "OPEN");
  assert.deepEqual(play!.signalKinds, ["BANGER"]);
  assert.equal(play!.archetype, "BREAKOUT");
});

// FINDINGS 2026-09-11: horizonPlayFromBangerPosition used to omit markAsOf entirely — a live
// banger-origin Swing position (the majority of the merged Swing live book) served mark=<value>
// with NO freshness signal at all, indistinguishable from "genuinely unknown" to any consumer
// (swing-e2e-healthcheck Stage F, Ask Largo's play-brief mark narrative). row.last_mark_at is the
// banger-table sibling of swing_positions.last_mark_at added in the same fix.
test("horizonPlayFromBangerPosition surfaces markAsOf from row.last_mark_at", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.markAsOf, "2026-09-04T20:55:00.000Z");
});

test("horizonPlayFromBangerPosition reports markAsOf null when no mark was ever observed", () => {
  const play = horizonPlayFromBangerPosition(
    bangerRow({ last_mark_at: null }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(play);
  assert.equal(play!.markAsOf, null);
});

test("mergeBangerPositionsIntoSwingPlays replaces pre-entry row on same ticker", () => {
  const watch: HorizonPlay = {
    ticker: "ANET",
    direction: "LONG",
    horizon: "SWING",
    score: 62,
    status: "WATCH",
    scoreFloor: 60,
    reason: "forming",
    contract: { strike: 150, expiry: "2026-09-12", right: "C", dte: 8, mid: 4.0 },
  };
  const merged = mergeBangerPositionsIntoSwingPlays([watch], [bangerRow()]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.status, "COMMIT");
  assert.equal(merged[0]!.signalKinds?.[0], "BANGER");
});

test("mergeBangerPositionsIntoSwingPlays keeps canonical swing OPEN when banger also open on ticker", () => {
  const managing: HorizonPlay = {
    ticker: "ANET",
    direction: "LONG",
    horizon: "SWING",
    score: 78,
    status: "COMMIT",
    scoreFloor: 60,
    reason: "swing ledger open",
    liveStatus: "OPEN",
    serving: "MANAGING",
    contract: { strike: 145, expiry: "2026-09-12", right: "C", dte: 8, mid: 5.1 },
  };
  const merged = mergeBangerPositionsIntoSwingPlays([managing], [bangerRow()]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.liveStatus, "OPEN");
  assert.equal(merged[0]!.reason, "swing ledger open");
  assert.notEqual(merged[0]!.signalKinds?.[0], "BANGER");
});

test("mergeBangerPositionsIntoSwingPlays replaces discovery COMMIT (no ledger) with open banger", () => {
  const discoveryCommit: HorizonPlay = {
    ticker: "ANET",
    direction: "LONG",
    horizon: "SWING",
    score: 72,
    status: "COMMIT",
    scoreFloor: 60,
    reason: "discovery scored above floor",
    serving: "COMMIT_NOW",
    contract: { strike: 150, expiry: "2026-09-12", right: "C", dte: 8, mid: 4.0 },
  };
  const merged = mergeBangerPositionsIntoSwingPlays([discoveryCommit], [bangerRow()]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.signalKinds?.[0], "BANGER");
  assert.equal(merged[0]!.serving, "MANAGING");
});

test("horizonPlayFromBangerPosition keeps an OPEN banger visible as it ages past HORIZONS.SWING.dteMin", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-10T16:00:00-04:00"));
  assert.ok(play, "an OPEN banger position must not disappear once it ages under dteMin");
  assert.equal(play!.contract.dte, 2);
  assert.equal(play!.serving, "MANAGING");
  assert.match(play!.reason, /closing soon/);
});

test("horizonPlayFromBangerPosition still excludes an already-expired contract (dte < 0)", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-13T16:00:00-04:00"));
  assert.equal(play, null);
});

// FINDINGS 2026-09-12 (live prod repro, ~85 of ~90 committed SWING rows): `factors[0].points` used
// to be the RAW discovery gain% (Math.round(gainPct)), a different quantity from `score` (which
// compounds it as 60 + gainPct/2). Both the command-deck "Why this play was picked" panel
// (PlayTerminal.tsx) and Ask Largo's play-brief "Score pillars" section (play-brief-intel.ts)
// render `factors` as if it sums to `score` — so a live commit read e.g. "SCORE 66" next to
// "Discovery gain +13 pts", a ~53-point unexplained gap. `factors[].points` must equal `score`
// exactly: this lane has no second pillar, so the whole score legitimately belongs to this one
// signal.
test("horizonPlayFromBangerPosition: factors sum to score exactly (no unexplained gap)", () => {
  const play = horizonPlayFromBangerPosition(
    bangerRow({ discovery_gain: 0.13 }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(play);
  const factorSum = (play!.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, play!.score);
});

test("horizonPlayFromBangerWatch: factors sum to score exactly (no unexplained gap)", () => {
  const mover: BangerMover = {
    ticker: "ODD",
    close: 60,
    gain: 0.13,
    vol: 2_000_000,
    dollar: 50_000_000,
    closeStrength: 0.8,
  };
  const play = horizonPlayFromBangerWatch(
    mover,
    { strike: 60, expiry: "2026-09-18", occ: "ODD250918C00060000", entryPremium: 2.1 },
    "2026-09-04",
  );
  assert.ok(play);
  const factorSum = (play!.factors ?? []).reduce((n, f) => n + f.points, 0);
  assert.equal(factorSum, play!.score);
});

test("horizonPlayFromBangerPosition still excludes a contract beyond HORIZONS.SWING.dteMax", () => {
  const play = horizonPlayFromBangerPosition(
    bangerRow({ contract_expiry: "2026-10-15" }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.equal(play, null);
});

test("horizonPlayFromBangerPosition does not mark 'closing soon' inside the normal Swing window", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.contract.dte, 8);
  assert.doesNotMatch(play!.reason, /closing soon/);
});
