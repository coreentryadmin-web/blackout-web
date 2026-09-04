import { test } from "node:test";
import assert from "node:assert/strict";
import { horizonPlayFromBangerPosition, mergeBangerPositionsIntoSwingPlays } from "./banger-lane-merge.ts";
import type { BangerPositionRow } from "../banger/positions-db.ts";
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

test("horizonPlayFromBangerPosition keeps an OPEN banger visible as it ages past HORIZONS.SWING.dteMin", () => {
  // Entered with plenty of runway (contract_expiry 2026-09-12); "now" is 2 calendar days out —
  // inside the 0DTE window (dte<5), which used to make this ledger row vanish from every view.
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
