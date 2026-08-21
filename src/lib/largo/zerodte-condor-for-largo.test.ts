import { strict as assert } from "node:assert";
import test from "node:test";
import { ironCondorProductForLargo, liveCondorForLargo } from "./zerodte-condor-for-largo";
import { SHIPPED_INTRADAY_BREACH_PCT, SURFACED_WIN_RATE_CAP } from "@/lib/zerodte/iron-condor";

test("the product descriptor answers 'what is the win rate' with the honest breach companion", () => {
  const p = ironCondorProductForLargo();
  // The whole point of the fix: a condor question is answerable with NO live position.
  assert.ok(Array.isArray(p.win_rate_by_width) && (p.win_rate_by_width as unknown[]).length > 0);
  assert.equal(p.intraday_breach_pct, SHIPPED_INTRADAY_BREACH_PCT);
  assert.equal(p.skew, "negative");
  assert.match(String(p.honest_skew_note), /NEGATIVE skew/);
  assert.match(String(p.honest_skew_note), /ALWAYS quote the intraday-breach rate/);
});

test("the surfaced win rate is NEVER a literal 100 — the cap is enforced", () => {
  const p = ironCondorProductForLargo();
  const rows = p.win_rate_by_width as Array<{ est_win_rate_pct: number }>;
  for (const r of rows) {
    assert.ok(r.est_win_rate_pct <= SURFACED_WIN_RATE_CAP, `${r.est_win_rate_pct} exceeds the cap`);
    assert.ok(r.est_win_rate_pct !== 100, "a ~75-sample backtest cannot support a literal 100%");
  }
  // The widest bucket's RAW rate is 100 — proving the cap actually bit, not that the data was tame.
  const widest = rows[rows.length - 1];
  assert.equal(widest.est_win_rate_pct, SURFACED_WIN_RATE_CAP);
});

test("width and win rate rise together — 0.6% ≈ 77, 0.8% ≈ 92", () => {
  const rows = ironCondorProductForLargo().win_rate_by_width as Array<{
    short_strike_distance_pct: number;
    est_win_rate_pct: number;
  }>;
  const at = (d: number) => rows.find((r) => Math.abs(r.short_strike_distance_pct - d) < 1e-9);
  assert.equal(at(0.6)?.est_win_rate_pct, 77);
  assert.equal(at(0.8)?.est_win_rate_pct, 92);
});

test("a live condor row surfaces its strikes and pairs win rate with breach rate", () => {
  const view = liveCondorForLargo({
    spot: 7800, short_put: 7750, long_put: 7740, short_call: 7850, long_call: 7860,
    wing_pts: 10, net_credit: 1.8, max_loss: 8.2, breach_lower: 7750, breach_upper: 7850,
    est_win_rate: 92, est_intraday_breach_pct: 18.7,
  });
  assert.ok(view);
  assert.equal(view!.structure, "iron_condor");
  assert.equal(view!.est_win_rate_pct, 92);
  assert.equal(view!.intraday_breach_pct, 18.7);
  assert.equal(view!.breach_rate_unmeasured, false);
  assert.equal(view!.short_put, 7750);
  assert.equal(view!.short_call, 7850);
});

test("a condor whose breach companion is absent is FLAGGED, not surfaced as free edge", () => {
  // Off-geometry condors null the breach rate upstream; the model must caption the missing tail.
  const view = liveCondorForLargo({
    spot: 7800, short_put: 7750, long_put: 7740, short_call: 7850, long_call: 7860,
    wing_pts: 10, net_credit: 1.8, max_loss: 8.2, breach_lower: 7750, breach_upper: 7850,
    est_win_rate: 88, est_intraday_breach_pct: null,
  });
  assert.equal(view!.est_win_rate_pct, 88);
  assert.equal(view!.intraday_breach_pct, null);
  assert.equal(view!.breach_rate_unmeasured, true, "a WR with no breach companion must be flagged");
});

test("a directional (non-condor) row has no condor view", () => {
  assert.equal(liveCondorForLargo(null), null);
});
