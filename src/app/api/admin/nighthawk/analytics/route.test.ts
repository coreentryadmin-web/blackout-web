import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { roundFloats } from "@/lib/round-floats";

// Source-pinned + behavioural. The handlers need live providers, so the wiring is pinned at source
// and the rounding SEMANTICS are exercised on the real live payload values.
const ANALYTICS = "src/app/api/admin/nighthawk/analytics/route.ts";
const CRON_HEALTH = "src/app/api/admin/cron-health/route.ts";

test("both admin routes round at the response boundary, like their market siblings", () => {
  assert.match(readFileSync(ANALYTICS, "utf8"), /roundFloats\(\s*\{ \.\.\.metrics/);
  assert.match(readFileSync(CRON_HEALTH, "utf8"), /roundFloats\(snapshot\)/);
});

test("REGRESSION: the exact live floats are cleaned", () => {
  // Verbatim from GET /api/admin/nighthawk/analytics on 2026-08-07.
  const served = roundFloats(
    {
      avg_return_pct: 0.4696125545466665,
      avg_return_pct_edge: -0.5324389852527139,
      avg_loser_return_pct: -9.648441937634674,
      segments: { legacy: { avg_return_pct: 0.012000911084166713 } },
    },
    2
  );
  assert.equal(served.avg_return_pct, 0.47);
  assert.equal(served.avg_return_pct_edge, -0.53);
  assert.equal(served.avg_loser_return_pct, -9.65);
  assert.equal(served.segments.legacy.avg_return_pct, 0.01);
  // cron-health's live value.
  assert.equal(roundFloats({ baseline_accuracy_pct: 39.99108337048596 }).baseline_accuracy_pct, 39.99);
});

test("the *_rate FRACTIONS keep their precision — not quantized to the nearest 1%", () => {
  // These are fractions of one, not percentages. A blanket 2dp is the #1867 defect repeating:
  // loss_rate 0.074 -> 0.07 loses a third of the value's resolution.
  const keyDp = { profitable_rate: 4, loss_rate: 4, open_rate: 4, profitable_rate_edge: 4, loss_rate_edge: 4 };
  const live = {
    profitable_rate: 0.6666666666666666,
    loss_rate: 0.07407407407407407,
    open_rate: 0.9259259259259259,
    profitable_rate_edge: 0.5555555555555556,
  };
  const served = roundFloats(live, 2, keyDp);
  assert.equal(served.profitable_rate, 0.6667);
  assert.equal(served.loss_rate, 0.0741);
  assert.equal(served.open_rate, 0.9259);
  assert.equal(served.profitable_rate_edge, 0.5556);

  // Pin what the naive call would have done, so nobody "simplifies" the keyDp away.
  assert.equal(roundFloats(live, 2).loss_rate, 0.07, "pre-fix: 2dp costs a third of the resolution");
});

test("the route actually passes that keyDp — the map is not decorative", () => {
  const src = readFileSync(ANALYTICS, "utf8");
  assert.match(src, /profitable_rate: 4, loss_rate: 4, open_rate: 4/);
});

test("the member /record route is deliberately untouched — it was already correct", () => {
  // record/route.ts:15,79-84 rounds explicitly and every live value was <= 1dp. Double-rounding it
  // would be churn, not a fix.
  const src = readFileSync("src/app/api/market/nighthawk/record/route.ts", "utf8");
  assert.doesNotMatch(src, /roundFloats/);
});
