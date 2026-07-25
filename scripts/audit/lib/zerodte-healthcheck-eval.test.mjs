import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollupVerdict,
  anyRed,
  verdictForStaleness,
  markAgreement,
  condorGeometryCheck,
  trackRecordConsistent,
  exitLifecycleCoherent,
  commitRowComplete,
} from "./zerodte-healthcheck-eval.mjs";

test("rollupVerdict: worst-of ordering RED > AMBER > GREEN > SKIPPED", () => {
  assert.equal(rollupVerdict(["GREEN", "GREEN"]), "GREEN");
  assert.equal(rollupVerdict(["GREEN", "AMBER"]), "AMBER");
  assert.equal(rollupVerdict(["GREEN", "AMBER", "RED"]), "RED");
  assert.equal(rollupVerdict([]), "SKIPPED");
  assert.equal(rollupVerdict(["SKIPPED", "SKIPPED"]), "SKIPPED");
  assert.equal(rollupVerdict(["SKIPPED", "GREEN"]), "GREEN");
});

test("anyRed: only a non-skipped RED gates the run", () => {
  assert.equal(anyRed(["GREEN", "AMBER", "SKIPPED"]), false);
  assert.equal(anyRed(["GREEN", "RED"]), true);
});

test("verdictForStaleness: fresh green, stale red during RTH, amber off-hours/unknown", () => {
  assert.equal(verdictForStaleness(1000, 5000, true), "GREEN");
  assert.equal(verdictForStaleness(9000, 5000, true), "RED");
  assert.equal(verdictForStaleness(9000, 5000, false), "AMBER");
  assert.equal(verdictForStaleness(null, 5000, true), "AMBER");
});

test("markAgreement: within tolerance passes, material divergence fails, missing → null", () => {
  assert.deepEqual(markAgreement(5.0, 5.0, 15), { ok: true, deltaPct: 0 });
  const near = markAgreement(5.5, 5.0, 15);
  assert.equal(near.ok, true);
  assert.ok(Math.abs(near.deltaPct - 10) < 1e-9);
  assert.equal(markAgreement(7.0, 5.0, 15).ok, false);
  assert.equal(markAgreement(null, 5.0, 15), null);
  assert.equal(markAgreement(5.0, 0, 15), null);
});

test("condorGeometryCheck: valid SPX condor passes; inverted legs fail", () => {
  const good = {
    spot: 7500,
    short_put: 7440,
    long_put: 7420,
    short_call: 7560,
    long_call: 7580,
    wing_pts: 20,
    net_credit: 180,
  };
  assert.deepEqual(condorGeometryCheck(good, { requireCredit: true }), { valid: true, reasons: [] });
  // long put NOT below short put (wing on wrong side) → invalid
  const bad = { ...good, long_put: 7450 };
  const r = condorGeometryCheck(bad);
  assert.equal(r.valid, false);
  assert.ok(r.reasons.some((x) => /long_put/.test(x)));
  // missing credit only fails when requireCredit
  assert.equal(condorGeometryCheck({ ...good, net_credit: null }).valid, true);
  assert.equal(condorGeometryCheck({ ...good, net_credit: null }, { requireCredit: true }).valid, false);
  // spot outside shorts fails
  assert.equal(condorGeometryCheck({ ...good, spot: 7600 }).valid, false);
  assert.equal(condorGeometryCheck(null).valid, false);
});

test("trackRecordConsistent: wins+losses+breakeven == graded", () => {
  assert.equal(trackRecordConsistent({ graded: 10, wins: 5, losses: 4, breakeven: 1 }).ok, true);
  assert.equal(trackRecordConsistent({ graded: 10, wins: 5, losses: 4, breakeven: 0 }).ok, false);
  assert.equal(trackRecordConsistent({ graded: 0, wins: 0, losses: 0, breakeven: 0 }).ok, true);
  assert.equal(trackRecordConsistent({ graded: null, wins: 1, losses: 0, breakeven: 0 }).ok, false);
});

test("exitLifecycleCoherent: stopped row must pin the stop P&L", () => {
  assert.equal(exitLifecycleCoherent({ status: "CLOSED", closed_reason: "stopped", live_pnl_pct: -50 }).ok, true);
  const wrong = exitLifecycleCoherent({ status: "CLOSED", closed_reason: "stopped", live_pnl_pct: -12 });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.reasons.some((x) => /stop/.test(x)));
  // live row without entry premium is incoherent
  assert.equal(exitLifecycleCoherent({ status: "OPEN", entry_premium: null }).ok, false);
  assert.equal(exitLifecycleCoherent({ status: "OPEN", entry_premium: 5.2 }).ok, true);
  // CLOSED with a time_stop label is coherent
  assert.equal(exitLifecycleCoherent({ status: "CLOSED", closed_reason: "time_stop" }).ok, true);
  // unknown status
  assert.equal(exitLifecycleCoherent({ status: "ZOMBIE" }).ok, false);
});

test("commitRowComplete: reports missing spine fields + snapshot presence", () => {
  const full = {
    entry_premium: 6.1,
    first_flagged_at: "2026-07-24T14:03:00Z",
    direction: "long",
    top_strike: 700,
    cortex: { verdict: "commit" },
  };
  const r = commitRowComplete(full);
  assert.equal(r.ok, true);
  assert.equal(r.hasSnapshot, true);
  const missing = commitRowComplete({ direction: "long" });
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("entry_premium"));
  assert.equal(missing.hasSnapshot, false);
});
