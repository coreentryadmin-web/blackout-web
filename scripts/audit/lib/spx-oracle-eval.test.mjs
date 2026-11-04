import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpxOracleRth, spxOracleVerdict } from "./spx-oracle-eval.mjs";

test("resolveSpxOracleRth: ET cash window wins when marketstatus missing (RTH deep audit 2026-11-04)", () => {
  const now = new Date("2026-11-04T21:02:17.099Z"); // Wed 16:02 ET
  assert.equal(resolveSpxOracleRth(null, now), true);
  assert.equal(resolveSpxOracleRth({ market: "closed" }, now), true);
});

test("resolveSpxOracleRth: honors Polygon closed off-hours", () => {
  const now = new Date("2026-11-04T02:00:00.000Z"); // Mon 9 PM ET prior day
  assert.equal(resolveSpxOracleRth({ market: "closed" }, now), false);
});

test("spxOracleVerdict: off-hours allows sub-1.5% drift (RTH deep audit 2026-11-02 false P0)", () => {
  const desk = 7552.74;
  const prevClose = 7541.4;
  const v = spxOracleVerdict(desk, prevClose, false);
  assert.equal(v.verdict, "pass");
  assert.ok(v.pct != null && v.pct < 1.5);
});

test("spxOracleVerdict: RTH uses tighter 0.3% tolerance", () => {
  const desk = 7550;
  const live = 7550 + 25; // ~0.33%
  assert.equal(spxOracleVerdict(desk, live, true).verdict, "fail");
  assert.equal(spxOracleVerdict(desk, live - 5, true).verdict, "pass");
});

test("spxOracleVerdict: live desk vs prev-close on a +1.5% day fails off-hours tol (2026-11-04 shape)", () => {
  const desk = 7683.82;
  const prevClose = 7568.92;
  const v = spxOracleVerdict(desk, prevClose, false);
  assert.equal(v.verdict, "fail");
  assert.ok(v.pct != null && v.pct > 1.5);
});

test("spxOracleVerdict: skip when inputs missing", () => {
  assert.equal(spxOracleVerdict(null, 100, true).verdict, "skip");
  assert.equal(spxOracleVerdict(100, 0, true).verdict, "skip");
});
