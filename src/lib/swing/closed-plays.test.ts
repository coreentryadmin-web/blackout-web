import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closedDeckSourceFromRow,
  closedDeckSourcesFromChains,
  trimEnforcedBeforeCloseFromScaleOutGrade,
} from "./closed-plays";
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
  // BUG FIX (2026-10-21, Ask Largo standing mandate, live repro BE): entryPremium/peakPremium/
  // troughPremium used to pass through as raw, unrounded DB floats. `terminalPlayFromClosedSwing`'s
  // `peakDisplay` (adapters.ts) derives a percentage directly from these raw values, while the
  // SEPARATE `GET /api/market/swing/record` HTTP route independently 2dp-rounds the SAME columns
  // via `roundFloats()` for the Command Deck UI's CLOSED tab (containers.tsx), which feeds the
  // identical `terminalPlayFromClosedSwing` function a different precision basis for the same
  // position. Live repro: brief said "Peak was +150.8%" off raw entry≈17.952/peak≈45.025, while
  // (45.03/17.95-1)*100 = 150.9% using the rounded dollar figures the record route/UI actually show.
  it("rounds entry/peak/trough premium to 2dp at the shared source (live repro BE rounding boundary)", () => {
    const src = closedDeckSourceFromRow(
      row({ entry_premium: 17.952, peak_premium: 45.025, trough_premium: 15.449 }),
    );
    assert.equal(src?.entryPremium, 17.95);
    assert.equal(src?.peakPremium, 45.03);
    assert.equal(src?.troughPremium, 15.45);
  });

  it("maps graded CLOSED row to CLOSED deck source", () => {
    const src = closedDeckSourceFromRow(row());
    assert.equal(src?.status, "CLOSED");
    assert.equal(src?.exitPnlPct, 30);
    assert.equal(src?.closedReason, "target");
    assert.equal(src?.positionId, 1);
    assert.equal(src?.score, 82, "a real evidence_score is carried through unchanged");
    assert.equal(src?.scoreWithheld, false, "a genuinely-scored row must not be flagged withheld");
  });

  // BUG FIX (Ask Largo standing mandate, live repro 2026-10-16): a ROLLED chain's terminal leg
  // never has its own `feature_vector` (roll-plan.ts's `buildRollPlan` never sets it on the child
  // row's insert spec), so `evidence_score` was unconditionally defaulted to the literal `0` with
  // no flag distinguishing it from a real, measured zero-conviction score. Live `GET
  // /api/market/swing/record` on 2026-10-16 showed exactly this: AMZN positionId 48 (rootPositionId
  // 44) and AAPL positionId 40 (rootPositionId 37) both served `"score": 0` verbatim while every
  // other field (reason/contract/archetype) was populated normally — a member reading the Closed
  // tab saw "SCORE 0" implying zero conviction/evidence at commit, which was simply false. Must
  // report `scoreWithheld: true`, same honest-absence idiom live-plays.ts's
  // `livePlayFromSwingPosition` already ships for the open-position sibling of this exact gap.
  it("flags scoreWithheld (not a fabricated 0) when the terminal leg's feature_vector is empty — the rolled-chain shape", () => {
    const rolled = closedDeckSourceFromRow(row({ feature_vector: null, roll_seq: 1, parent_position_id: 44, root_position_id: 44 }));
    assert.equal(rolled?.score, 0, "score still falls back to 0 — a non-nullable field needs SOME value");
    assert.equal(rolled?.scoreWithheld, true, "but it must be flagged as withheld, not presented as a real zero");
  });

  it("flags scoreWithheld when feature_vector exists but carries no numeric evidence_score (malformed/legacy row)", () => {
    const malformed = closedDeckSourceFromRow(row({ feature_vector: { pil_regime: 0.5 } }));
    assert.equal(malformed?.score, 0);
    assert.equal(malformed?.scoreWithheld, true);
  });

  it("does NOT flag scoreWithheld when the row genuinely scored evidence_score:0 (a real, measured zero)", () => {
    const real = closedDeckSourceFromRow(row({ feature_vector: { evidence_score: 0 } }));
    assert.equal(real?.score, 0);
    assert.equal(real?.scoreWithheld, false, "a real measured 0 must not be conflated with an absent one");
  });

  // GAP FOUND (2026-09-28, Ask Largo standing mandate): entry_underlying_px/thesis_invalidation_px
  // are static (pinned at commit, never depend on live state) so they stay valid post-close, but
  // this mapper never carried them onto SwingClosedDeckSource — silently withholding the two
  // numbers closedCoaching's "check if entry was extended past invalidation" line needs to answer
  // its own question (play-brief-narrative-coaching.ts).
  it("carries entry-trigger/invalidation underlying levels onto the closed deck source", () => {
    const src = closedDeckSourceFromRow(row({ entry_underlying_px: 175, thesis_invalidation_px: 170 }));
    assert.equal(src?.entryTriggerUnderlyingPx, 175);
    assert.equal(src?.invalidationUnderlyingPx, 170);
  });

  it("reports null levels honestly when the row itself has none", () => {
    const src = closedDeckSourceFromRow(row({ entry_underlying_px: null, thesis_invalidation_px: null }));
    assert.equal(src?.entryTriggerUnderlyingPx, null);
    assert.equal(src?.invalidationUnderlyingPx, null);
  });

  it("skips open rows and ungraded closes", () => {
    assert.equal(closedDeckSourceFromRow(row({ status: "OPEN" })), null);
    assert.equal(closedDeckSourceFromRow(row({ graded_at: null })), null);
  });

  // GAP FOUND (2026-10-07, Ask Largo standing mandate): gradeSwingPosition (db.ts) unconditionally
  // overwrites a CLOSED row's `status` to CLOSED/ROLLED, so a position that was really TRIM at some
  // point before it closed could never again be told apart from one that never trimmed at all —
  // every closed play-brief's trim ladder read "0 fired" regardless of real history. Fixed by
  // persisting the pre-update status fact into `scale_out_grade` at grade time; this mapper must
  // surface it honestly (real true/false, or null when the row predates the fix).
  describe("trimEnforcedBeforeClose", () => {
    it("surfaces true when scale_out_grade recorded a real pre-close trim", () => {
      const src = closedDeckSourceFromRow(row({ scale_out_grade: { trim_enforced_before_close: true } }));
      assert.equal(src?.trimEnforcedBeforeClose, true);
    });

    it("surfaces false (not null) when scale_out_grade recorded no trim — a real negative fact", () => {
      const src = closedDeckSourceFromRow(row({ scale_out_grade: { trim_enforced_before_close: false } }));
      assert.equal(src?.trimEnforcedBeforeClose, false);
    });

    it("is honestly null (never a fabricated false) when scale_out_grade is absent — a row graded before this field existed", () => {
      const src = closedDeckSourceFromRow(row({ scale_out_grade: null }));
      assert.equal(src?.trimEnforcedBeforeClose, null);
    });

    it("trimEnforcedBeforeCloseFromScaleOutGrade: ignores a non-boolean value rather than coercing it", () => {
      assert.equal(trimEnforcedBeforeCloseFromScaleOutGrade({ trim_enforced_before_close: "yes" }), null);
      assert.equal(trimEnforcedBeforeCloseFromScaleOutGrade(undefined), null);
      assert.equal(trimEnforcedBeforeCloseFromScaleOutGrade({}), null);
    });
  });

  // BUG FIX (2026-09-22, Ask Largo standing mandate — Largo C3 absence). `contract_type` is a
  // genuinely nullable DB column (TEXT, no NOT NULL). The old `row.contract_type === "put" ? "P" :
  // "C"` ternary fabricated a "C" (call) for a null/unrecorded contract_type instead of ever
  // actually checking for "call" — a trader would read a fabricated "call" as a real recorded
  // fact about a closed position. Absence must stay absent (return null, same as the existing
  // missing-expiry/strike cases), never silently become "call".
  it("returns null (not a fabricated call) when contract_type was never recorded", () => {
    assert.equal(closedDeckSourceFromRow(row({ contract_type: null })), null);
  });

  it("returns null for an unrecognized contract_type value, same fail-closed rule", () => {
    assert.equal(closedDeckSourceFromRow(row({ contract_type: "unknown" })), null);
  });

  it("still correctly identifies a real put (not defaulted to call)", () => {
    const src = closedDeckSourceFromRow(row({ contract_type: "put" }));
    assert.equal(src?.contract.right, "P");
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
    assert.equal(
      out[0]!.positionId,
      10,
      "positionId must identify the worst leg (10), whose P&L/contract/premium bounds this card actually shows — not the terminal leg (11), which this card never describes",
    );
    assert.equal(out[0]!.exitPnlPct, -20, "worst-leg composite, not terminal-leg +15");
    assert.equal(out[0]!.closedReason, "stopped");
  });

  // BUG FIX (2026-09-15, Ask Largo standing mandate, forensic batch 31, live repro INTC:30/35): the
  // row above already proves exitPnlPct correctly sources the WORST leg's P&L (-20, the parent) —
  // but entryPremium/peakPremium/troughPremium still came from the TERMINAL leg's own row
  // regardless, pairing leg 1's price bounds with leg 0's realized loss. Live: leg 1's own bounds
  // (entry 2.26 -> peak 2.84, "+25.7%") were shown beside leg 0's -40.83% realized loss — a
  // positive peak next to a reported loss, for a peak that chronologically postdates the loss it's
  // paired with.
  //
  // SUPERSEDED (2026-10-21, Ask Largo standing mandate, live repro AMZN positionId 48/AAPL
  // positionId 40): this test originally asserted the three fields come back `null` in this case —
  // that was itself a bug, not the fix. `entry_premium`/`peak_premium`/`trough_premium` are real
  // PER-LEG columns on `SwingPositionRow` (same class as `contract_strike`/`last_mark`, which the
  // sibling contract-identity fix below already correctly borrows from the worst leg's own row) —
  // the worst leg's own bounds (the PARENT's real 3.6/3.6/2.13 here) were sitting right there to
  // borrow instead of nulling. Updated to assert the worst leg's OWN bounds are served, not the
  // terminal leg's (still never paired with the wrong leg) and not null (never omitted when a real
  // per-leg value exists).
  it("borrows entry/peak/trough premium from the WORST leg's own row when it is NOT the terminal leg (mismatched-leg pairing)", () => {
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
    assert.equal(out[0]!.entryPremium, 3.6, "must be the WORST leg's own entry, not the terminal's 2.26 and not null");
    assert.equal(out[0]!.peakPremium, 3.6, "must be the WORST leg's own peak, not the terminal's +25.7%-implying 2.84");
    assert.equal(out[0]!.troughPremium, 2.13, "must be the WORST leg's own trough, not the terminal's 1.29");
    assert.equal(out[0]!.positionId, 30, "positionId must identify the worst leg (30), not the terminal leg (35)");
  });

  // BUG FIX (Ask Largo standing mandate, 2026-10-11, live repro AMZN root 44/terminal 48): the
  // 2026-09-15 fix just above nulls entryPremium/peakPremium/troughPremium when the worst leg isn't
  // the terminal leg, but left `contract`/`occ` untouched — the IDENTICAL mismatch one layer
  // deeper. Live: leg 44 (strike 605, expiry 2026-10-16, -27.67%, ROLLED) rolled into leg 48 (a
  // DIFFERENT contract — strike 245, expiry 2026-10-09, +72.41%, CLOSED); the served row paired the
  // composite's correctly-preserved -27.67% loss with leg 48's OWN contract/occ — a contract that
  // never lost 27.67%. Must resolve leg 44's own contract/occ instead, not the terminal's.
  it("resolves the WORST leg's own contract/occ when it is a genuinely different contract than the terminal leg (mismatched-leg contract identity)", () => {
    const parent = row({
      id: 44,
      roll_seq: 0,
      realized_pnl_pct: -27.67,
      contract_strike: 605,
      contract_expiry: "2026-10-16",
      contract_type: "call",
      contract_occ: "O:AMZN261016C00605000",
      entry_premium: 5.15,
      graded_at: "2026-09-30T13:31:19.000Z",
      closed_at: "2026-09-30T13:31:19.000Z",
    });
    const terminal = row({
      id: 48,
      roll_seq: 1,
      parent_position_id: 44,
      root_position_id: 44,
      realized_pnl_pct: 72.41,
      contract_strike: 245,
      contract_expiry: "2026-10-09",
      contract_type: "call",
      contract_occ: "AMZN261009C00245000",
      entry_premium: 5.8,
      closed_at: "2026-10-07T13:30:39.000Z",
      graded_at: "2026-10-07T13:30:39.000Z",
    });
    const out = closedDeckSourcesFromChains([[parent, terminal]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, -27.67, "worst leg (parent) still drives the reported exit P&L");
    assert.equal(out[0]!.occ, "O:AMZN261016C00605000", "occ must identify the leg that actually lost -27.67%, not the terminal leg's own contract");
    assert.equal(out[0]!.contract.strike, 605, "strike must match the contract the P&L belongs to");
    assert.equal(out[0]!.contract.expiry, "2026-10-16");
    assert.equal(out[0]!.positionId, 44, "positionId must identify leg 44, the same leg occ/contract/exitPnlPct already point at");
  });

  // BUG FIX (Ask Largo standing mandate, 2026-10-18, live repro AAPL positionId 40 (root 37 ->
  // terminal 40) + AMZN positionId 48 (root 44 -> terminal 48)): the 2026-10-11 fix just above
  // correctly re-points strike/right/expiry/occ at the worst leg — but `closedDeckSourcesFromChains`
  // built `contract` as `{ ...src.contract, <identity fields only> }`, so `mid`/`delta` survived the
  // spread UNCHANGED from `src.contract` (closedDeckSourceFromRow(terminal)'s own `last_mark`/
  // `contract_delta`) — a DIFFERENT real contract's own price, merged onto the correctly-identified
  // worst leg's card. Live AAPL: served contract 330C 2026-09-21 (leg 37, correctly identified)
  // carried mid 7.70/delta 0.48 — leg 40's (terminal) own exit_mark/delta; leg 37's REAL exit_mark
  // was 5.23, matching its own -22.3% realizedPnlPct. Live AMZN: served contract showed mid
  // 10.00/delta 0.6 — leg 48's (terminal) own quote; leg 44's (worst leg) REAL exit_mark was 3.73,
  // matching its own -27.67% realizedPnlPct. Must source mid/delta from the SAME worst-leg row the
  // identity fields already come from, never from the terminal leg.
  it("resolves the WORST leg's own mid/delta too, not just its identity (mismatched-leg contract price — live repro AMZN positionId 48/44)", () => {
    const parent = row({
      id: 44,
      roll_seq: 0,
      realized_pnl_pct: -27.67,
      contract_strike: 605,
      contract_expiry: "2026-10-16",
      contract_type: "call",
      contract_occ: "O:AMZN261016C00605000",
      contract_delta: 0.42,
      entry_premium: 5.15,
      last_mark: 3.73, // leg 44's REAL own exit_mark — matches its -27.67% realizedPnlPct
      graded_at: "2026-09-30T13:31:19.000Z",
      closed_at: "2026-09-30T13:31:19.000Z",
    });
    const terminal = row({
      id: 48,
      roll_seq: 1,
      parent_position_id: 44,
      root_position_id: 44,
      realized_pnl_pct: 72.41,
      contract_strike: 245,
      contract_expiry: "2026-10-09",
      contract_type: "call",
      contract_occ: "AMZN261009C00245000",
      contract_delta: 0.6,
      entry_premium: 5.8,
      last_mark: 10.0, // leg 48's own exit_mark — a DIFFERENT contract's price, must not leak onto leg 44's card
      closed_at: "2026-10-07T13:30:39.000Z",
      graded_at: "2026-10-07T13:30:39.000Z",
    });
    const out = closedDeckSourcesFromChains([[parent, terminal]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, -27.67, "worst leg (parent) still drives the reported exit P&L");
    assert.equal(out[0]!.occ, "O:AMZN261016C00605000", "occ must identify the leg that actually lost -27.67%");
    assert.equal(out[0]!.contract.strike, 605);
    assert.equal(
      out[0]!.contract.mid,
      3.73,
      "mid must be the WORST leg's own exit_mark (3.73), not the terminal leg's own exit_mark (10.00) — two different real contracts must not be merged onto one card",
    );
    assert.equal(out[0]!.contract.delta, 0.42, "delta must be the WORST leg's own delta, not the terminal leg's (0.6)");
    assert.equal(out[0]!.positionId, 44, "positionId must identify leg 44 — the same leg every other field on this card already describes");
  });

  // Second independent live repro of the same bug (AAPL positionId 40, root 37) — a DIFFERENT chain
  // shape than the AMZN one above (the worst leg here is the ROOT/first leg, not a middle leg), kept
  // as its own test so a fix that happens to work only for one chain shape can't pass silently.
  it("resolves the WORST leg's own mid/delta too — live repro AAPL positionId 40/37", () => {
    const worst = row({
      id: 37,
      roll_seq: 0,
      ticker: "AAPL",
      realized_pnl_pct: -22.3,
      contract_strike: 330,
      contract_expiry: "2026-09-21",
      contract_type: "call",
      contract_occ: "AAPL260921C00330000",
      contract_delta: 0.3,
      entry_premium: 6.73,
      last_mark: 5.23, // leg 37's REAL own exit_mark — matches its -22.3% realizedPnlPct
      graded_at: "2026-09-10T15:00:00Z",
      closed_at: "2026-09-10T15:00:00Z",
    });
    const terminal = row({
      id: 40,
      roll_seq: 1,
      parent_position_id: 37,
      root_position_id: 37,
      ticker: "AAPL",
      realized_pnl_pct: 15.0,
      contract_strike: 350,
      contract_expiry: "2026-10-16",
      contract_type: "call",
      contract_occ: "AAPL261016C00350000",
      contract_delta: 0.48,
      entry_premium: 6.7,
      last_mark: 7.7, // leg 40's own exit_mark — a DIFFERENT contract's price, must not leak onto leg 37's card
      closed_at: "2026-09-18T15:00:00Z",
      graded_at: "2026-09-18T15:00:00Z",
    });
    const out = closedDeckSourcesFromChains([[worst, terminal]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, -22.3);
    assert.equal(out[0]!.occ, "AAPL260921C00330000");
    assert.equal(out[0]!.contract.strike, 330);
    assert.equal(out[0]!.contract.expiry, "2026-09-21");
    assert.equal(
      out[0]!.contract.mid,
      5.23,
      "mid must be leg 37's own exit_mark (5.23), not leg 40's own exit_mark (7.70)",
    );
    assert.equal(out[0]!.contract.delta, 0.3, "delta must be leg 37's own delta, not leg 40's (0.48)");
    assert.equal(out[0]!.positionId, 37, "positionId must identify leg 37, not the terminal leg 40");
  });

  // BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro AMZN positionId 48 (root 44) + AAPL
  // positionId 40 (root 37) — the exact GET /api/market/swing/record rows from 2026-10-21): the
  // 2026-10-18 fix above correctly borrows the worst leg's own mid/delta/identity, but
  // entryPremium/peakPremium/troughPremium were STILL unconditionally nulled — the code comment at
  // the time claimed these three fields have "no per-leg equivalent to borrow", which is false:
  // `entry_premium`/`peak_premium`/`trough_premium` are real per-row columns on `SwingPositionRow`,
  // the exact same class as `contract_strike`/`last_mark`/`contract_delta` already borrowed above.
  // Live: AMZN leg 44 (worst leg, -27.67%) has real entry_premium 5.15; the served row showed
  // entryPremium null despite that value sitting on the very same `worstLegRow` object already read
  // for contract/mid/delta two lines above. Same for AAPL leg 37 (entry_premium 6.73, -22.3%).
  it("borrows the WORST leg's own entryPremium/peakPremium/troughPremium, not null — live repro AMZN positionId 48/44", () => {
    const parent = row({
      id: 44,
      roll_seq: 0,
      realized_pnl_pct: -27.67,
      contract_strike: 605,
      contract_expiry: "2026-10-16",
      contract_type: "call",
      contract_occ: "O:AMZN261016C00605000",
      entry_premium: 5.15, // leg 44's REAL own entry — must be served, not nulled
      peak_premium: 5.15,
      trough_premium: 3.73,
      last_mark: 3.73,
      graded_at: "2026-09-30T13:31:19.000Z",
      closed_at: "2026-09-30T13:31:19.000Z",
    });
    const terminal = row({
      id: 48,
      roll_seq: 1,
      parent_position_id: 44,
      root_position_id: 44,
      realized_pnl_pct: 72.41,
      contract_strike: 245,
      contract_expiry: "2026-10-09",
      contract_type: "call",
      contract_occ: "AMZN261009C00245000",
      entry_premium: 5.8, // terminal leg's own entry — must NOT leak onto the worst leg's card
      peak_premium: 10.0,
      trough_premium: 5.8,
      last_mark: 10.0,
      closed_at: "2026-10-07T13:30:39.000Z",
      graded_at: "2026-10-07T13:30:39.000Z",
    });
    const out = closedDeckSourcesFromChains([[parent, terminal]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.exitPnlPct, -27.67);
    assert.equal(out[0]!.entryPremium, 5.15, "must be leg 44's own entry_premium, not null and not leg 48's 5.8");
    assert.equal(out[0]!.peakPremium, 5.15, "must be leg 44's own peak_premium, not null and not leg 48's 10.0");
    assert.equal(out[0]!.troughPremium, 3.73, "must be leg 44's own trough_premium, not null and not leg 48's 5.8");
    assert.equal(
      out[0]!.positionId,
      44,
      "positionId must identify leg 44 (the worst leg, whose contract/premiums this card shows) — serving 48 (the terminal leg) would resolve a DIFFERENT, contradicting brief on click-through",
    );
  });

  it("falls back to null (genuine absence, not a leg mismatch) when the worst leg's own premium columns are themselves null", () => {
    const parent = row({
      id: 50,
      roll_seq: 0,
      realized_pnl_pct: -30,
      entry_premium: null,
      peak_premium: null,
      trough_premium: null,
      graded_at: "2026-08-05T12:00:00Z",
    });
    const child = row({
      id: 51,
      roll_seq: 1,
      parent_position_id: 50,
      root_position_id: 50,
      realized_pnl_pct: 10,
      entry_premium: 4.0,
      peak_premium: 4.5,
      trough_premium: 3.5,
      closed_at: "2026-08-12T12:00:00Z",
      graded_at: "2026-08-12T12:05:00Z",
    });
    const out = closedDeckSourcesFromChains([[parent, child]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.entryPremium, null, "a real absence on the worst leg's own row must stay null, never borrowed from the terminal leg");
    assert.equal(out[0]!.peakPremium, null);
    assert.equal(out[0]!.troughPremium, null);
    assert.equal(out[0]!.positionId, 50, "positionId still identifies the worst leg (50) even when its premium columns are themselves genuinely absent");
  });

  // BUG FIX (Ask Largo standing mandate, live repro 2026-10-16, same AMZN root-44/terminal-48 chain
  // as the contract-identity fix above): the chain-composite path's `score`/`scoreWithheld` come
  // from `closedDeckSourceFromRow(terminal)` — the rolled CHILD leg, which never carries its own
  // `feature_vector` (roll-plan.ts's `buildRollPlan` never sets it). Live `GET
  // /api/market/swing/record` served `"score": 0` verbatim for this exact chain. Note the PARENT
  // leg (id 44) below keeps the default fixture's real `evidence_score: 82` — proving the withheld
  // flag genuinely comes from the terminal leg's own missing feature_vector, not from any chain-wide
  // absence-of-evidence check.
  it("flags scoreWithheld on the served chain row when the terminal (rolled-child) leg has no feature_vector — the real AMZN 44/48 shape", () => {
    const parent = row({
      id: 44,
      roll_seq: 0,
      realized_pnl_pct: -27.67,
      graded_at: "2026-09-30T13:31:19.000Z",
      closed_at: "2026-09-30T13:31:19.000Z",
      // Real fixture default (evidence_score: 82) left deliberately in place on the PARENT — see
      // this test's own comment above.
    });
    const terminal = row({
      id: 48,
      roll_seq: 1,
      parent_position_id: 44,
      root_position_id: 44,
      realized_pnl_pct: 72.41,
      feature_vector: null, // roll children never get one — the actual root cause
      closed_at: "2026-10-07T13:30:39.000Z",
      graded_at: "2026-10-07T13:30:39.000Z",
    });
    const out = closedDeckSourcesFromChains([[parent, terminal]]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.score, 0, "still a 0 fallback -- score stays non-nullable");
    assert.equal(
      out[0]!.scoreWithheld,
      true,
      "must be flagged withheld -- a member must not read this as a real zero-conviction commit",
    );
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
    assert.equal(out[0]!.positionId, 41, "when the worst leg IS the terminal leg, positionId stays the terminal's own id (no re-pointing needed)");
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
