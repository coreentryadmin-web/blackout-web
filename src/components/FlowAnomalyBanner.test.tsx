import assert from "node:assert/strict";
import { test } from "node:test";

import { visibleFlowAnomalies } from "./FlowAnomalyBanner";

// The bug: the banner previously tracked a single `dismissed: boolean` that,
// once set, hid the banner for the rest of the session — even once the
// underlying `anomalies` array changed to contain a brand new anomaly the
// member never saw (let alone dismissed). `visibleFlowAnomalies` is the pure
// filter now used by the component; it must scope a dismissal to the exact
// ids that were on screen at the moment "Dismiss" was clicked, not to
// "anything that will ever render again."

test("visibleFlowAnomalies hides anomalies whose id was dismissed", () => {
  const anomalies = [{ id: "a1" }, { id: "a2" }];
  const dismissedIds = new Set(["a1", "a2"]);
  assert.deepEqual(visibleFlowAnomalies(anomalies, dismissedIds), []);
});

test("visibleFlowAnomalies does NOT suppress a genuinely new anomaly that arrives after a dismissal", () => {
  // Member dismisses the single LOW-severity anomaly on screen...
  const firstPoll = [{ id: "low-1", severity: "LOW" as const }];
  const dismissedIds = new Set(firstPoll.map((a) => a.id));
  assert.deepEqual(visibleFlowAnomalies(firstPoll, dismissedIds), []);

  // ...the next poll a few minutes later picks up a brand-new, unrelated
  // CRITICAL anomaly with a different id. The stale dismissal must not hide
  // it — this is exactly the scenario a blanket `dismissed: boolean` gets
  // wrong, because it hides the banner regardless of what it would contain.
  const secondPoll = [
    { id: "low-1", severity: "LOW" as const }, // still within its recency window
    { id: "critical-1", severity: "CRITICAL" as const },
  ];
  assert.deepEqual(visibleFlowAnomalies(secondPoll, dismissedIds), [
    { id: "critical-1", severity: "CRITICAL" as const },
  ]);
});

test("visibleFlowAnomalies re-shows a previously-dismissed id if it reappears as a fresh row (defensive: ids aren't reused by design, but the filter itself must stay a pure set membership check)", () => {
  const dismissedIds = new Set<string>();
  const anomalies = [{ id: "x" }];
  assert.deepEqual(visibleFlowAnomalies(anomalies, dismissedIds), anomalies);
});
