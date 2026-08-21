import { strict as assert } from "node:assert";
import test from "node:test";
import { bangerPnlForModel, isClosedBangerStatus } from "./banger-pnl";

// The five CLOSED_RUNNER rows measured on the live board 2026-08-21. Each one is a case where the
// old field would have quoted the mark-to-market of the remaining leg as if it were the result.
const WRBY = { status: "CLOSED_RUNNER", entry_premium: 0.65, last_mark: 0.43, scaled_already: true, realized_pnl_pct: 32.69 };

test("a closed row reports its RECORDED realized result, not a mark-derived one", () => {
  const v = bangerPnlForModel(WRBY);
  assert.equal(v.realized_pnl_pct, 32.69);
  assert.equal(v.pnl_basis, "realized_as_managed");
  // The number the defect produced. -33.8% for a position that made +32.69%.
  const markDerived = ((WRBY.last_mark - WRBY.entry_premium) / WRBY.entry_premium) * 100;
  assert.ok(markDerived < 0 && v.realized_pnl_pct > 0, "the two numbers disagree on the SIGN");
});

test("a closed row never carries live_pnl_pct — 'live' on a closed position is a lie", () => {
  assert.equal(bangerPnlForModel(WRBY).live_pnl_pct, undefined);
  assert.equal(
    bangerPnlForModel({ status: "STOPPED", entry_premium: 0.17, last_mark: 0.06, scaled_already: false, realized_pnl_pct: -60 })
      .live_pnl_pct,
    undefined
  );
});

test("a scaled close says the figure blends a banked tranche, so it cannot be re-derived", () => {
  assert.match(bangerPnlForModel(WRBY).pnl_note ?? "", /banked tranche/);
  // An unscaled close needs no such warning and does not get noise it does not need.
  const unscaled = bangerPnlForModel({ status: "STOPPED", entry_premium: 0.23, last_mark: 0.09, scaled_already: false, realized_pnl_pct: -60 });
  assert.equal(unscaled.pnl_note, undefined);
  assert.equal(unscaled.realized_pnl_pct, -60);
});

test("a closed row with no realized figure withholds the number rather than substituting one", () => {
  const v = bangerPnlForModel({ status: "CLOSED_RUNNER", entry_premium: 0.5, last_mark: 0.9, scaled_already: true, realized_pnl_pct: null });
  assert.equal(v.pnl_basis, "unknown");
  assert.equal(v.realized_pnl_pct, undefined);
  assert.equal(v.live_pnl_pct, undefined, "a +80% mark-to-market must not stand in for an unrecorded result");
  assert.match(v.pnl_note ?? "", /do not compute one/);
});

test("an open row still reports mark-to-market, under the name that says so", () => {
  const v = bangerPnlForModel({ status: "OPEN", entry_premium: 0.5, last_mark: 0.75, scaled_already: false, realized_pnl_pct: null });
  assert.equal(v.live_pnl_pct, 50);
  assert.equal(v.pnl_basis, "mark_to_market");
  assert.equal(v.realized_pnl_pct, undefined);
});

test("a PARTIAL row discloses that a banked tranche is missing from its live number", () => {
  const v = bangerPnlForModel({ status: "PARTIAL", entry_premium: 0.5, last_mark: 0.4, scaled_already: true, realized_pnl_pct: null });
  assert.equal(v.pnl_basis, "mark_to_market");
  // Unrounded on purpose: `roundFloats` at the payload boundary is the one rounding authority,
  // and a second one here could make the tool and the board disagree in the last decimal.
  assert.ok(Math.abs((v.live_pnl_pct ?? 0) + 20) < 1e-9);
  assert.match(v.pnl_note ?? "", /REMAINING leg only/);
});

test("an open row with no mark has no P&L, not a flat one", () => {
  const v = bangerPnlForModel({ status: "OPEN", entry_premium: 0.5, last_mark: null, scaled_already: false, realized_pnl_pct: null });
  assert.equal(v.pnl_basis, "unknown");
  assert.equal(v.live_pnl_pct, undefined, "0% would read as 'flat', which is a claim we cannot make");
  assert.match(v.pnl_note ?? "", /not a flat one/);
});

test("a zero entry premium cannot produce an infinite return", () => {
  const v = bangerPnlForModel({ status: "OPEN", entry_premium: 0, last_mark: 0.4, scaled_already: false, realized_pnl_pct: null });
  assert.equal(v.pnl_basis, "unknown");
  assert.equal(v.live_pnl_pct, undefined);
});

test("only the two terminal statuses count as closed", () => {
  assert.equal(isClosedBangerStatus("CLOSED_RUNNER"), true);
  assert.equal(isClosedBangerStatus("STOPPED"), true);
  assert.equal(isClosedBangerStatus("OPEN"), false);
  assert.equal(isClosedBangerStatus("PARTIAL"), false);
});
