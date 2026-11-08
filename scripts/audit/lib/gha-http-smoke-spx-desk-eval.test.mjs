import test from "node:test";
import assert from "node:assert/strict";
import { spxDeskSmokeVerdict } from "./gha-http-smoke-spx-desk-eval.mjs";

test("live RTH: price > 0 passes", () => {
  const v = spxDeskSmokeVerdict(200, { price: 5780.5, available: true });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "live_price");
});

test("off-hours: 200 with price 0 but available boolean passes", () => {
  const v = spxDeskSmokeVerdict(200, { price: 0, available: false, source: "none" });
  assert.equal(v.ok, true);
  assert.equal(v.kind, "desk_shell");
});

test("cron secret drift: 401 warns but passes", () => {
  const v = spxDeskSmokeVerdict(401, {});
  assert.equal(v.ok, true);
  assert.equal(v.kind, "warn_cron_drift");
});

test("broken deploy: 404 fails", () => {
  const v = spxDeskSmokeVerdict(404, {});
  assert.equal(v.ok, false);
});

test("ungrounded 200 without desk shape fails", () => {
  const v = spxDeskSmokeVerdict(200, {});
  assert.equal(v.ok, false);
  assert.equal(v.detail, "ungrounded_200");
});
