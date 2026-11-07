import { test } from "node:test";
import assert from "node:assert/strict";
import { weekAnalyticsSub } from "./meridian-week-analytics-sub";

test("weekAnalyticsSub shows the revenue beat rate when EPS has no gradeable prints", () => {
  // Live shape: dualBeatRateFromPrints grades eps/revenue on independent cohorts, so a name
  // can have zero eps-graded prints (eps_beat_rate null) while revenue is well-graded.
  const out = weekAnalyticsSub({
    printed_this_week: 12,
    names_count: 40,
    eps_beat_rate: null,
    revenue_beat_rate: 0.62,
    revenue_graded: 96,
  });
  assert.equal(out, "12/40 printed · rev beat 62% of 96 prints");
});

test("weekAnalyticsSub omits the clause entirely when neither rate is gradeable", () => {
  const out = weekAnalyticsSub({
    printed_this_week: 12,
    names_count: 40,
    eps_beat_rate: null,
    revenue_beat_rate: null,
  });
  assert.equal(out, "12/40 printed");
});

test("weekAnalyticsSub shows the honest dash when EPS is gradeable but revenue is not", () => {
  const out = weekAnalyticsSub({
    printed_this_week: 12,
    names_count: 40,
    eps_beat_rate: 0.5,
    revenue_beat_rate: null,
  });
  assert.equal(out, "12/40 printed · rev beat —");
});

test("weekAnalyticsSub shows the revenue rate with its own cohort when both are gradeable", () => {
  const out = weekAnalyticsSub({
    printed_this_week: 12,
    names_count: 40,
    eps_beat_rate: 0.8,
    revenue_beat_rate: 0.62,
    revenue_graded: 96,
  });
  assert.equal(out, "12/40 printed · rev beat 62% of 96 prints");
});

test("weekAnalyticsSub omits the cohort suffix when revenue_graded is absent or zero", () => {
  const out = weekAnalyticsSub({
    printed_this_week: 12,
    names_count: 40,
    eps_beat_rate: null,
    revenue_beat_rate: 0.62,
  });
  assert.equal(out, "12/40 printed · rev beat 62%");
});
