import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markFlowDataFresh,
  newestFlowAgeMsFromBriefs,
  resolveFlowDataAgeMs,
} from "./flow-data-freshness";

test("newestFlowAgeMsFromBriefs uses the newest alerted_at row", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = newestFlowAgeMsFromBriefs(
    [
      { alerted_at: "2026-06-29T15:30:00.000Z" },
      { alerted_at: "2026-06-29T15:58:00.000Z" },
    ],
    now
  );
  assert.equal(age, 2 * 60_000);
});

test("resolveFlowDataAgeMs prefers fresh tape over stale in-memory stamp", () => {
  markFlowDataFresh(Date.parse("2026-06-29T14:00:00.000Z"));
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = resolveFlowDataAgeMs([{ alerted_at: "2026-06-29T15:58:00.000Z" }], now);
  assert.equal(age, 2 * 60_000);
});

test("newestFlowAgeMsFromBriefs: clock-skewed future alerted_at is null, not 0ms fresh (age-0 trap)", () => {
  // Same class as #4471/#4472/#4473: a future stamp must never clamp to "live right now".
  // This helper recomputes `newest` straight from the payload on every call, so unlike
  // `flowDataAgeMs` (guarded upstream by markFlowDataFresh's real-clock future rejection) it
  // needs its own guard — the RED case this fix closes.
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const age = newestFlowAgeMsFromBriefs([{ alerted_at: "2026-06-29T16:10:00.000Z" }], now);
  assert.equal(age, null);
});
