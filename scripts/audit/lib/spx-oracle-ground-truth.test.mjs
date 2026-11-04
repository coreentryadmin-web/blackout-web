import test from "node:test";
import assert from "node:assert/strict";
import {
  spxOracleGroundTruthPlan,
  resolvePolygonSpxOracleGroundTruth,
} from "./spx-oracle-ground-truth.mjs";

test("spxOracleGroundTruthPlan: RTH uses live snapshot", () => {
  assert.equal(
    spxOracleGroundTruthPlan({ rth: true, now: new Date("2026-11-04T15:00:00.000Z") }),
    "live"
  );
});

test("spxOracleGroundTruthPlan: post-close on trading day uses today-close not /prev", () => {
  // Wed 2026-11-04 16:02 ET = 21:02 UTC
  assert.equal(
    spxOracleGroundTruthPlan({ rth: false, now: new Date("2026-11-04T21:02:00.000Z") }),
    "today-close"
  );
});

test("spxOracleGroundTruthPlan: pre-open weekday still uses prev-close", () => {
  assert.equal(
    spxOracleGroundTruthPlan({ rth: false, now: new Date("2026-11-04T13:00:00.000Z") }),
    "prev-close"
  );
});

test("resolvePolygonSpxOracleGroundTruth: post-close fetches today daily bar", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes("/range/1/day/2026-11-04/2026-11-04")) {
      return {
        ok: true,
        json: async () => ({ results: [{ c: 7683.82 }] }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };
  const { value, label } = await resolvePolygonSpxOracleGroundTruth({
    polyBase: "https://api.polygon.io",
    polyKey: "test-key",
    rth: false,
    now: new Date("2026-11-04T21:02:00.000Z"),
    fetchFn,
  });
  assert.equal(label, "today-close");
  assert.equal(value, 7683.82);
  assert.ok(calls.some((u) => u.includes("/range/1/day/2026-11-04/2026-11-04")));
  assert.equal(calls.some((u) => u.includes("/prev")), false);
});

test("spxOracleGroundTruthPlan + verdict: desk vs today-close passes RTH deep audit 2026-11-04 case", async () => {
  const { spxOracleVerdict } = await import("./spx-oracle-eval.mjs");
  const desk = 7683.82;
  const gt = 7686.23;
  const v = spxOracleVerdict(desk, gt, false);
  assert.equal(v.verdict, "pass");
});
