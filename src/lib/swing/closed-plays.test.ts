import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closedDeckSourceFromRow, closedDeckSourcesFromChains } from "./closed-plays";
import type { SwingPositionRow } from "../db";

function row(overrides: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 1,
    commit_key: "k",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-08-01",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "standard",
    archetype: "MOMENTUM",
    top_flow_strike: 180,
    contract_strike: 180,
    contract_expiry: "2026-08-15",
    contract_type: "call",
    contract_occ: "O:NVDA250815C00180000",
    contract_delta: 0.55,
    entry_underlying_px: 175,
    thesis_invalidation_px: 170,
    target_underlying_px: 190,
    entry_premium: 5.0,
    last_mark: 6.5,
    last_mark_at: "2026-08-10T15:00:00Z",
    peak_premium: 7.0,
    trough_premium: 4.2,
    underlying_mfe: 8,
    underlying_mae: -2,
    realized_pnl_pct: 30,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: { evidence_score: 82 },
    plan_json: null,
    scale_out_grade: null,
    grade_json: {},
    grade_methodology: "swing",
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: "2026-08-01T10:00:00Z",
    committed_at: "2026-08-02T14:30:00Z",
    closed_at: "2026-08-10T16:00:00Z",
    graded_at: "2026-08-10T16:05:00Z",
    updated_at: "2026-08-10T16:05:00Z",
    ...overrides,
  };
}

describe("closedDeckSourceFromRow", () => {
  it("maps graded CLOSED row to CLOSED deck source", () => {
    const src = closedDeckSourceFromRow(row());
    assert.equal(src?.status, "CLOSED");
    assert.equal(src?.exitPnlPct, 30);
    assert.equal(src?.closedReason, "target");
    assert.equal(src?.positionId, 1);
  });

  it("skips open rows and ungraded closes", () => {
    assert.equal(closedDeckSourceFromRow(row({ status: "OPEN" })), null);
    assert.equal(closedDeckSourceFromRow(row({ graded_at: null })), null);
  });

  // BUG FIX (2026-09-18, Ask Largo standing mandate, live repro PYPL#24): a true flat/breakeven
  // close (entryPremium === peakPremium === troughPremium) can carry float-division residue in
  // realized_pnl_pct (e.g. -0.0001, not a real loss) — must round before the sign check, else this
  // mislabels a scratch exit as "stopped" (implying a stop-loss fired, which it did not).
  it("labels a float-residue near-zero P&L as 'flat', never 'stopped' (live repro PYPL#24)", () => {
    const src = closedDeckSourceFromRow(row({ realized_pnl_pct: -0.0001 }));
    assert.equal(src?.closedReason, "flat");
  });

  it("still labels a real, rounds-to-nonzero loss as 'stopped'", () => {
    const src = closedDeckSourceFromRow(row({ realized_pnl_pct: -0.5 }));
    assert.equal(src?.closedReason, "stopped");
  });

  it("freezes dte to the trade's own exit date, never recomputed against today (FINDINGS 2026-09-06)", () => {
    // Fixture's expiry (2026-08-15) and closed_at (2026-08-10) are both far in this test's
    // past relative to whenever the suite actually runs — a live `calendarDte(today, expiry)`
    // read would go negative (contract already expired) the moment "today" outran the expiry,
    // and would silently change on every re-run before that. The honest DTE-at-exit value is
    // fixed by the row's own timestamps and must never move: 2026-08-10 -> 2026-08-15 = 5.
    const src = closedDeckSourceFromRow(row());
    assert.equal(src?.contract.dte, 5, "dte must be frozen at exit (closed_at), not live against now()");
  });

  it("still reports a sane frozen dte for an already-expired contract (EWZ/GLW shape)", () => {
    // Reproduces the exact live production shape from the audit: expiry == closed_at date (the
    // contract expired the same session the position was closed/graded). A live `now()` read
    // taken any day after would print negative; the frozen exit-date read must stay 0, forever.
    const src = closedDeckSourceFromRow(
      row({
        contract_expiry: "2026-09-04",
        closed_at: "2026-09-04T20:05:00Z",
        graded_at: "2026-09-04T20:10:00Z",
      }),
    );
    assert.equal(src?.contract.dte, 0);
  });

  it("falls back to graded_at when closed_at is absent", () => {
    const src = closedDeckSourceFromRow(row({ closed_at: null, graded_at: "2026-08-12T16:05:00Z" }));
    assert.equal(src?.contract.dte, 3, "2026-08-12 -> 2026-08-15 expiry = 3 dte at grading time");
    assert.equal(src?.exitAt, "2026-08-12T16:05:00Z");
  });

  it("surfaces flow-strike provenance on the root leg but suppresses it on a rolled leg (stale top_flow_strike vs freshly re-picked contract_strike)", () => {
    const rootMatched = closedDeckSourceFromRow(row({ top_flow_strike: 180, contract_strike: 180, roll_seq: 0 }));
    assert.deepEqual(rootMatched?.topFlowProvenance, { topFlowStrike: 180, matchedPick: true });

    const rolled = closedDeckSourceFromRow(row({ top_flow_strike: 180, contract_strike: 180, roll_seq: 1 }));
    assert.equal(
      rolled?.topFlowProvenance,
      null,
      "a rolled leg's re-picked contract_strike must never be compared against the stale original top_flow_strike",
    );
  });
});

describe("closedDeckSourcesFromChains", () => {
  it("emits one row per resolved chain using chain-composite P&L (Q26)", () => {
    const parent = row({ id: 10, roll_seq: 0, realized_pnl_pct: -20, graded_at: "2026-08-05T12:00:00Z" });
    const child = row({
      id: 11,
      roll_seq: 1,
      parent_position_id: 10,
      root_position_id: 10,
      realized_pnl_pct: 15,
      closed_at: "2026-08-12T12:00:00Z",
      graded_at: "2026-08-12T12:05:00Z",
    });
    const out = closedDeckSourcesFromChains([[parent, child]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.positionId, 11);
    assert.equal(out[0]!.exitPnlPct, -20, "worst-leg composite, not terminal-leg +15");
    assert.equal(out[0]!.closedReason, "stopped");
  });

  // BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 31, live repro INTC:30/35): the
  // row above already proves exitPnlPct correctly sources the WORST leg's P&L (-20, the parent) —
  // but entryPremium/peakPremium/troughPremium still came from the TERMINAL leg's own row
  // regardless, pairing leg 1's price bounds with leg 0's realized loss. Live: leg 1's own bounds
  // (entry 2.26 -> peak 2.84, "+25.7%") were shown beside leg 0's -40.83% realized loss — a
  // positive peak next to a reported loss, for a peak that chronologically postdates the loss it's
  // paired with. Must omit (null) rather than fabricate a pairing.
  it("omits entry/peak/trough premium when the worst leg is NOT the terminal leg (mismatched-leg pairing)", () => {
    const parent = row({
      id: 30,
      roll_seq: 0,
      realized_pnl_pct: -40.83,
      entry_premium: 3.6,
      peak_premium: 3.6,
      trough_premium: 2.13,
      graded_at: "2026-08-05T12:00:00Z",
    });
    const child = row({
      id: 35,
      roll_seq: 1,
      parent_position_id: 30,
      root_position_id: 30,
      realized_pnl_pct: -33.19,
      entry_premium: 2.26,
      peak_premium: 2.84,
      trough_premium: 1.29,
      closed_at: "2026-08-12T12:00:00Z",
      graded_at: "2026-08-12T12:05:00Z",
    });
    const out = closedDeckSourcesFromChains([[parent, child]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, -40.83, "worst leg (parent) drives the reported exit P&L");
    assert.equal(out[0]!.entryPremium, null, "terminal leg's own entry doesn't describe the worst leg's journey");
    assert.equal(out[0]!.peakPremium, null, "terminal leg's own peak (+25.7%) must not pair with the worse loss");
    assert.equal(out[0]!.troughPremium, null);
  });

  it("keeps entry/peak/trough premium when the worst leg IS the terminal leg (no mismatch to omit)", () => {
    const parent = row({
      id: 40,
      roll_seq: 0,
      realized_pnl_pct: -5,
      graded_at: "2026-08-05T12:00:00Z",
    });
    const child = row({
      id: 41,
      roll_seq: 1,
      parent_position_id: 40,
      root_position_id: 40,
      realized_pnl_pct: -40.83,
      entry_premium: 2.26,
      peak_premium: 2.84,
      trough_premium: 1.29,
      closed_at: "2026-08-12T12:00:00Z",
      graded_at: "2026-08-12T12:05:00Z",
    });
    const out = closedDeckSourcesFromChains([[parent, child]]);
    assert.equal(out[0]!.exitPnlPct, -40.83, "terminal leg is also the worst leg here");
    assert.equal(out[0]!.entryPremium, 2.26, "terminal leg's own bounds ARE the worst leg's bounds -- keep them");
    assert.equal(out[0]!.peakPremium, 2.84);
    assert.equal(out[0]!.troughPremium, 1.29);
  });

  // BUG FIX (2026-09-13, live repro NFLX#12/WULF#13/IGV#16/WULF#17/PYPL#24): a single-leg chain
  // that closes at EXACTLY its entry price (realized_pnl_pct === 0, not a rounding artifact — the
  // live rows all carried entry_premium === peak_premium === trough_premium, the premium never
  // moved a cent) reported closedReason "stopped", implying a stop-loss actively fired. It didn't
  // — `isSwingWin(0)` is false (correctly, `pnl > 0` is a strict win bar) so the composite outcome
  // is "loss" by the file's own preserved-loss design, but the LABEL for that case must say "flat"
  // (matching what the sibling single-leg closedReasonFromRow already does), not "stopped".
  it("labels a chain that closed EXACTLY flat (0% P&L) as 'flat', never 'stopped' — nothing actually stopped out", () => {
    const flat = row({ id: 20, roll_seq: 0, realized_pnl_pct: 0, entry_premium: 1.4, peak_premium: 1.4, trough_premium: 1.4 });
    const out = closedDeckSourcesFromChains([[flat]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, 0);
    assert.equal(out[0]!.closedReason, "flat");
  });

  it("still labels a real, non-zero loss 'stopped' — the flat fix does not weaken the loss label", () => {
    const out = closedDeckSourcesFromChains([[row({ id: 21, roll_seq: 0, realized_pnl_pct: -0.01 })]]);
    assert.equal(out[0]!.closedReason, "stopped");
  });
});
