import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpxDeskSmokeProbe } from "./gha-spx-desk-smoke-eval.mjs";

test("evaluateSpxDeskSmokeProbe: pass on live price", () => {
  assert.deepEqual(
    evaluateSpxDeskSmokeProbe({ status: 200, body: { price: 6721.5, available: true } }),
    { outcome: "pass", detail: "price_6721.5" }
  );
});

test("evaluateSpxDeskSmokeProbe: pass on prior_close when spot missing", () => {
  assert.deepEqual(
    evaluateSpxDeskSmokeProbe({
      status: 200,
      body: { price: 0, prior_close: 6710.2, available: true },
    }),
    { outcome: "pass", detail: "prior_close_6710.2" }
  );
});

test("evaluateSpxDeskSmokeProbe: warn on cron drift", () => {
  assert.deepEqual(evaluateSpxDeskSmokeProbe({ status: 401, body: { error: "Unauthorized" } }), {
    outcome: "warn",
    detail: "route_gated_401",
  });
});

test("evaluateSpxDeskSmokeProbe: warn on honest degraded desk (Massive outage pattern)", () => {
  assert.deepEqual(
    evaluateSpxDeskSmokeProbe({
      status: 200,
      body: {
        price: 0,
        prior_close: null,
        available: false,
        as_of: "2026-11-08T17:13:34.259Z",
        source: "none",
      },
    }),
    { outcome: "warn", detail: "desk_degraded_unavailable" }
  );
});

test("evaluateSpxDeskSmokeProbe: fail when claiming available with zero spot", () => {
  assert.deepEqual(
    evaluateSpxDeskSmokeProbe({
      status: 200,
      body: { price: 0, available: true, as_of: "2026-11-08T17:00:00.000Z" },
    }),
    { outcome: "fail", detail: "available_true_price_zero" }
  );
});

test("evaluateSpxDeskSmokeProbe: fail on 502", () => {
  assert.deepEqual(evaluateSpxDeskSmokeProbe({ status: 502, body: { available: false } }), {
    outcome: "fail",
    detail: "http_502",
  });
});
