import { test } from "node:test";
import assert from "node:assert/strict";
import {
  livePlayFromSwingPosition,
  livePlaysFromOpenPositions,
  liveQuoteFromEvent,
  structuralBreakFromSpot,
} from "./live-plays.ts";
import type { SwingPositionRow } from "../db.ts";

function row(over: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "2026-07-24:NVDA:STANDARD:long",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-07-24",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 180,
    contract_expiry: "2026-08-14",
    contract_type: "call",
    contract_occ: null,
    contract_delta: 0.6,
    entry_underlying_px: 175,
    thesis_invalidation_px: 165,
    target_underlying_px: 190,
    entry_premium: 5.1,
    last_mark: 5.5,
    peak_premium: 5.5,
    trough_premium: 5.0,
    underlying_mfe: 178,
    underlying_mae: 174,
    realized_pnl_pct: null,
    entry_context: {},
    gate_calibration_json: {},
    feature_vector: { evidence_score: 82 },
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "OPEN",
    first_seen_at: "2026-07-24T14:00:00.000Z",
    committed_at: "2026-07-24T14:00:00.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-07-24T14:00:00.000Z",
    ...over,
  };
}

test("structuralBreakFromSpot: LONG breaks at/below invalidation; SHORT above", () => {
  assert.equal(structuralBreakFromSpot("long", 165, 165), true);
  assert.equal(structuralBreakFromSpot("long", 166, 165), false);
  assert.equal(structuralBreakFromSpot("short", 110, 110), true);
  assert.equal(structuralBreakFromSpot("short", 109, 110), false);
  assert.equal(structuralBreakFromSpot("long", null, 165), false);
});

test("livePlayFromSwingPosition: OPEN → MANAGING observables; TRIM → TAKE_PARTIAL", () => {
  const open = livePlayFromSwingPosition(row(), 178)!;
  assert.equal(open.liveStatus, "OPEN");
  assert.equal(open.manageAction, undefined);
  assert.equal(open.thesisLevel, "intact");
  assert.equal(open.score, 82);

  const trim = livePlayFromSwingPosition(row({ status: "TRIM" }), 178)!;
  assert.equal(trim.liveStatus, "TRIM");
  assert.equal(trim.manageAction, "TAKE_PARTIAL");
});

test("livePlayFromSwingPosition: structural break stamps EXIT + thesis break", () => {
  const play = livePlayFromSwingPosition(row(), 160)!; // below 165 invalidation
  assert.equal(play.manageAction, "EXIT");
  assert.equal(play.thesisLevel, "break");
});

test("livePlayFromSwingPosition: latest manage snapshot overrides spot-only intact read", () => {
  const play = livePlayFromSwingPosition(
    row(),
    178,
    { action: "EXIT", rung: "expiry_risk", thesis_state: "EXPIRY_RISK" },
  )!;
  assert.equal(play.manageAction, "EXIT");
  assert.equal(play.thesisLevel, "intact");
});

test("livePlayFromSwingPosition: stamps real DTE, entry, and live P&L from ledger row", () => {
  const play = livePlayFromSwingPosition(row(), 178)!;
  assert.ok(play.contract.dte >= 0);
  assert.notEqual(play.contract.dte, 0);
  assert.equal(play.entryPremium, 5.1);
  assert.equal(play.livePnlPct, 7.8); // (5.5/5.1 - 1)*100 ≈ 7.8
  assert.equal(play.peakPremium, 5.5);
});

test("livePlaysFromOpenPositions skips CLOSED and contract-less rows", () => {
  const plays = livePlaysFromOpenPositions(
    [
      row({ id: 1, status: "OPEN" }),
      row({ id: 2, status: "CLOSED", ticker: "AMD" }),
      row({ id: 3, status: "OPEN", ticker: "MSFT", contract_expiry: null }),
    ],
    { NVDA: 178 },
  );
  assert.equal(plays.length, 1);
  assert.equal(plays[0]!.ticker, "NVDA");
});


// ─── SEV-1 (FINDINGS 2026-08-06): an absent mark must serve NULL, never the entry premium ──────

test("SEV-1: a null last_mark serves contract.mid = null — NEVER laundered into the entry premium", () => {
  // The 42P08 bug left last_mark NULL on two live-money positions for a whole RTH session. The read
  // path used to emit `mid: mark ?? entry`, so the deck received a mark exactly equal to entry and
  // rendered a confident "+$0.00" — a precise, wrong number on a position that was really +36%.
  // "Unknown" must stay unknown all the way to the renderer, which already has a "—" branch for it.
  // The exact shape of the two stuck production rows: entry known, every live latch still NULL.
  const p = livePlayFromSwingPosition(
    row({ last_mark: null, peak_premium: null, trough_premium: null, entry_premium: 14.4 })
  );
  assert.ok(p);
  assert.equal(p!.contract!.mid, null, "no live mark → no fabricated mark");
  assert.equal(p!.entryPremium, 14.4, "entry premium is still reported (it is genuinely known)");
  assert.equal(p!.livePnlPct, null);
  assert.equal(p!.peakPremium, null);
  assert.equal(p!.troughPremium, null);
});

test("SEV-1: a real last_mark still lands on contract.mid unchanged", () => {
  // The honesty fix must not cost the working case: a genuine mark is passed straight through.
  const p = livePlayFromSwingPosition(row({ last_mark: 19.5, entry_premium: 14.4 }));
  assert.ok(p);
  assert.equal(p!.contract!.mid, 19.5);
  assert.equal(p!.livePnlPct, 35.4); // (19.5/14.4 - 1) * 100, rounded to 0.1
});


// ─── SEV-2 (FINDINGS 2026-08-06): a live position must carry a live QUOTE + greeks, not just a mark ──

test("SEV-2: contract hydrates bid/ask/OI/greeks from the manage snapshot's event_json.quote", () => {
  // The 15-min cron already fetched all of this (fetchOptionsUnifiedSnapshot) and used to keep only
  // `.mark`; every committed swing therefore served bid null / ask null / OI 0 / no greeks, while
  // pre-entry discovery plays (contract straight off a chain fetch) carried real quotes. Inverse split.
  const p = livePlayFromSwingPosition(row({ last_mark: 5.5 }), 178, {
    rung: "hold",
    action: "HOLD",
    quote: {
      bid: 5.4,
      ask: 5.6,
      openInterest: 1234,
      delta: 0.58,
      gamma: 0.021,
      theta: -0.13,
      vega: 0.19,
      iv: 0.42,
      asOf: "2026-08-06T18:30:00.000Z",
    },
  });
  assert.ok(p);
  const c = p!.contract!;
  assert.equal(c.bid, 5.4);
  assert.equal(c.ask, 5.6);
  assert.equal(c.openInterest, 1234);
  assert.equal(c.gamma, 0.021);
  assert.equal(c.theta, -0.13);
  assert.equal(c.vega, 0.19);
  assert.equal(c.iv, 0.42);
  // LIVE delta wins over the commit-pinned row.contract_delta (0.6 in the fixture).
  assert.equal(c.delta, 0.58);
  // The mark stays the ledger's latched value — the quote never re-prices the position.
  assert.equal(c.mid, 5.5);
});

test("SEV-2: no quote on the snapshot → honest nulls, and the commit-pinned delta is the fallback", () => {
  const p = livePlayFromSwingPosition(row({ last_mark: 5.5 }), 178, { rung: "hold", action: "HOLD" });
  assert.ok(p);
  const c = p!.contract!;
  assert.equal(c.bid, null);
  assert.equal(c.ask, null);
  assert.equal(c.gamma, null, "missing must look missing — never a fabricated greek");
  assert.equal(c.theta, null);
  assert.equal(c.vega, null);
  assert.equal(c.iv, null);
  assert.equal(c.delta, 0.6, "no live delta → the commit-pinned delta, which is genuinely known");
  assert.equal(c.openInterest, 0);
});

test("liveQuoteFromEvent: malformed / empty / absent quote blobs all degrade to null", () => {
  assert.equal(liveQuoteFromEvent(null), null);
  assert.equal(liveQuoteFromEvent({}), null);
  assert.equal(liveQuoteFromEvent({ quote: "nope" }), null);
  // An object present but carrying nothing usable is the same as no quote (never "quoted with nulls").
  assert.equal(liveQuoteFromEvent({ quote: { bid: null, ask: null, iv: "high" } }), null);
  // Partial quotes survive: non-finite fields drop to null, the real ones come through.
  const q = liveQuoteFromEvent({ quote: { bid: 1.2, ask: Number.NaN, gamma: 0.01 } });
  assert.deepEqual(q, {
    bid: 1.2,
    ask: null,
    openInterest: null,
    delta: null,
    gamma: 0.01,
    theta: null,
    vega: null,
    iv: null,
    asOf: null,
  });
});
