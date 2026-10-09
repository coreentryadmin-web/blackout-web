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
    trough_premium: 3.9,
    bid: null,
    ask: null,
    open_interest: null,
    quote_delta: null,
    quote_gamma: null,
    quote_theta: null,
    quote_vega: null,
    quote_iv: null,
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

// FINDINGS 2026-10-09 (Ask Largo standing mandate — migration 017): contract.bid/ask/openInterest/
// delta/gamma/theta/vega/iv were ALWAYS hardcoded null/0 on every BANGER-origin committed position,
// regardless of what the provider actually quoted — not because the data was unavailable, but
// because banger_positions had no column to hold it (fixed by migration 017 + updateBangerQuoteFields,
// banger-live-sync's cron already fetches this exact snapshot every tick for the quote-tick log).
// This proves the honest round-trip both ways: real values surface when the row carries them, and
// absence stays honest null (never fabricated) when it does not — the exact C6 discipline this file's
// other FINDINGS comments already apply to trough_premium/markAsOf.
test("horizonPlayFromBangerPosition serves real bid/ask/OI/greeks when the row carries a quote", () => {
  const play = horizonPlayFromBangerPosition(
    bangerRow({
      bid: 5.4,
      ask: 5.6,
      open_interest: 812,
      quote_delta: 0.63,
      quote_gamma: 0.019,
      quote_theta: -0.21,
      quote_vega: 0.14,
      quote_iv: 0.71,
    }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(play);
  assert.equal(play!.contract.bid, 5.4);
  assert.equal(play!.contract.ask, 5.6);
  assert.equal(play!.contract.openInterest, 812);
  assert.equal(play!.contract.delta, 0.63);
  assert.equal(play!.contract.gamma, 0.019);
  assert.equal(play!.contract.theta, -0.21);
  assert.equal(play!.contract.vega, 0.14);
  assert.equal(play!.contract.iv, 0.71);
});

test("horizonPlayFromBangerPosition serves honest null quote fields when the row has none yet (never fabricated)", () => {
  const play = horizonPlayFromBangerPosition(bangerRow(), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.contract.bid, null);
  assert.equal(play!.contract.ask, null);
  assert.equal(play!.contract.openInterest, 0);
  assert.equal(play!.contract.delta, null);
  assert.equal(play!.contract.gamma, null);
  assert.equal(play!.contract.theta, null);
  assert.equal(play!.contract.vega, null);
  assert.equal(play!.contract.iv, null);
});

// FINDINGS 2026-09-21 (Ask Largo/Night Hawk Swings audit): horizonPlayFromBangerPosition built
// peakPremium off row.peak_premium but omitted troughPremium entirely — not merely null, the key
// was never set on the returned object — because banger_positions had no trough_premium column
// to read from at all. Ask Largo's play-brief Position card ("Trough: —") and closed-play
// "Drawdown before outcome" narrative both read HorizonPlay.troughPremium, so every BANGER-origin
// swing play rendered as if it had never dipped below entry, regardless of the real path. Now
// that the column + latch exist (positions-db.ts), this must forward it exactly like peakPremium.
test("horizonPlayFromBangerPosition forwards troughPremium from the row (was previously omitted entirely)", () => {
  const play = horizonPlayFromBangerPosition(bangerRow({ trough_premium: 3.9 }), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.troughPremium, 3.9);
});

test("horizonPlayFromBangerPosition passes through a genuinely-null troughPremium honestly (never fabricated)", () => {
  const play = horizonPlayFromBangerPosition(bangerRow({ trough_premium: null }), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.troughPremium, null);
});

// FINDINGS 2026-09-20: horizonPlayFromBangerPosition used to omit `positionId` entirely, so
// CommandDeck's row identity (`id: ${horizon}:${ticker}${positionId ? `:${positionId}` : ""}`,
// adapters.ts terminalPlayFromHorizon) collapsed to the bare `SWING:TICKER` for every banger-
// origin row. Two banger legs sharing a ticker (real production shape: a MANAGING leg and an
// already-scaled SCALING_OUT leg on the same name) then shared ONE React key, which is what a
// live repro on the Swings desk's ticker search actually surfaced as unrelated tickers bleeding
// into a search result. `row.id` is banger_positions' own primary key, so it must survive onto
// the play the same way swing_positions.id already does via livePlaysFromOpenPositions.
test("horizonPlayFromBangerPosition carries row.id through as positionId", () => {
  const play = horizonPlayFromBangerPosition(bangerRow({ id: 4242 }), new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(play);
  assert.equal(play!.positionId, 4242);
});

test("two banger-origin plays on the same ticker get distinct positionIds (no CommandDeck key collision)", () => {
  const managing = horizonPlayFromBangerPosition(
    bangerRow({ id: 10, ticker: "ABTC", scaled_already: false, status: "OPEN" }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  const scalingOut = horizonPlayFromBangerPosition(
    bangerRow({ id: 11, ticker: "ABTC", contract_strike: 9.5, scaled_already: true, status: "PARTIAL" }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(managing);
  assert.ok(scalingOut);
  assert.equal(managing!.serving, "MANAGING");
  assert.equal(scalingOut!.serving, "SCALING_OUT");
  assert.notEqual(managing!.positionId, scalingOut!.positionId);
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

// Regression for the live 2026-10-08 bug: when no live mark has ever synced (last_mark null —
// the real, confirmed-live state of the overwhelming majority of the committed BANGER-origin
// book), `contract.mid` must stay honestly null, NEVER fall back to entry_premium. Before the
// fix: `mid === entry_premium` exactly, which downstream made markDollarPnl compute 0 (not null)
// and the Command Deck's primary P&L tile render a confident "+$0.00" instead of "—" (unknown).
test("horizonPlayFromBangerPosition does not fabricate contract.mid as entry_premium when no live mark has synced", () => {
  const play = horizonPlayFromBangerPosition(
    bangerRow({ entry_premium: 0.3, last_mark: null, last_mark_at: null }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(play);
  assert.equal(play!.contract.mid, null, "an absent live mark must stay null, never entry_premium");
  // Sanity: a REAL live mark still passes through unchanged (the fix only removes the fallback,
  // it does not touch a genuine mark).
  const withMark = horizonPlayFromBangerPosition(
    bangerRow({ entry_premium: 0.3, last_mark: 0.45, last_mark_at: "2026-09-04T20:55:00.000Z" }),
    new Date("2026-09-04T16:00:00-04:00"),
  );
  assert.ok(withMark);
  assert.equal(withMark!.contract.mid, 0.45);
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
  const merged = mergeBangerPositionsIntoSwingPlays(
    [watch],
    [bangerRow()],
    new Date("2026-09-04T16:00:00-04:00"),
  );
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
  const merged = mergeBangerPositionsIntoSwingPlays(
    [managing],
    [bangerRow()],
    new Date("2026-09-04T16:00:00-04:00"),
  );
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
  const merged = mergeBangerPositionsIntoSwingPlays(
    [discoveryCommit],
    [bangerRow()],
    new Date("2026-09-04T16:00:00-04:00"),
  );
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

// FOUND LIVE 2026-10-09 (Ask Largo standing mandate): `subLane` was computed from TODAY's `dte`
// (`subLaneForDte(dte)`) on every tick, not frozen at entry — the exact opposite of how every
// other identity-ish field on this row behaves (`row.sub_lane` is read as a stored, commit-time
// value for NATIVE swing positions in live-plays.ts; `manage.ts`'s own dossier resolver prefers a
// persisted `subLane` and only falls back to a live recompute when one was never stored at all).
// Consequence: a BANGER-origin position entered at 8 DTE (STANDARD) silently reclassifies to
// TACTICAL as it ages through the 5-7 DTE band, then LOSES its sub-lane entirely (becomes
// `undefined`) once dte drops under TACTICAL's own floor (5) — exactly the "closing soon" window
// this file's own header comment says must stay visible, not quietly lose its classification.
// Reproduced live 2026-10-09 against prod: XP/PBR/CIEN/SG/PSX/PSKY (all BANGER-origin, all
// dte=0 "closing soon") every one serves `subLane: undefined` on `/api/market/nighthawk/horizons`.
// This isn't cosmetic: `play-brief.ts`'s execution-quality section looks up
// `SWING_SUB_LANES[play.subLane]?.liquidity.maxSpreadPct` to compare the position's CURRENT
// spread against the entry-time liquidity bar it was picked under (`SWING_SUB_LANES[subLane]`,
// see that file's own "GAP FOUND 2026-09-18" comment) — once subLane goes undefined, that lookup
// silently resolves to `null` and the brief drops the comparison line entirely, precisely on the
// final-day positions where spread-vs-liquidity scrutiny matters most.
test("horizonPlayFromBangerPosition freezes subLane at its ENTRY dte, not the live/current dte", () => {
  // session_date 2026-09-04, contract_expiry 2026-09-09 -> entry dte = 5 -> TACTICAL (5-7) at entry.
  const row = bangerRow({ session_date: "2026-09-04", contract_expiry: "2026-09-09" });

  const atEntry = horizonPlayFromBangerPosition(row, new Date("2026-09-04T16:00:00-04:00"));
  assert.ok(atEntry);
  assert.equal(atEntry!.contract.dte, 5);
  assert.equal(atEntry!.subLane, "TACTICAL");

  // Same position, now on its expiry day (dte=0 live) — still genuinely open/managing. subLane
  // must stay the SAME "TACTICAL" it was entered under, not drift to undefined because today's
  // dte (0) no longer falls in TACTICAL's own 5-7 band.
  const onExpiryDay = horizonPlayFromBangerPosition(row, new Date("2026-09-09T10:00:00-04:00"));
  assert.ok(onExpiryDay);
  assert.equal(onExpiryDay!.contract.dte, 0);
  assert.equal(
    onExpiryDay!.subLane,
    "TACTICAL",
    "subLane must stay frozen at its entry-time classification, not vanish as the live dte ages past it",
  );
});

test("horizonPlayFromBangerPosition freezes a STANDARD-entry subLane through to expiry too", () => {
  // session_date 2026-09-04, contract_expiry 2026-09-12 -> entry dte = 8 -> STANDARD (8-15) at entry.
  const row = bangerRow({ session_date: "2026-09-04", contract_expiry: "2026-09-12" });

  const nearExpiry = horizonPlayFromBangerPosition(row, new Date("2026-09-12T10:00:00-04:00"));
  assert.ok(nearExpiry);
  assert.equal(nearExpiry!.contract.dte, 0);
  assert.equal(nearExpiry!.subLane, "STANDARD");
});
