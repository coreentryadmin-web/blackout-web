import { test } from "node:test";
import assert from "node:assert/strict";
import { priorScheduledMacroEvents } from "@/lib/providers/macro-events";

test("priorScheduledMacroEvents: returns CPI prints before a date", () => {
  const rows = priorScheduledMacroEvents({
    event: "CPI",
    beforeYmd: "2026-08-12",
    limit: 4,
  });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.date < "2026-08-12"));
  assert.ok(rows.every((r) => r.event.toLowerCase().includes("cpi")));
});

test("priorScheduledMacroEvents: FOMC decisions only", () => {
  const rows = priorScheduledMacroEvents({
    event: "FOMC Decision",
    beforeYmd: "2026-08-12",
    limit: 3,
  });
  assert.ok(rows.every((r) => r.event.includes("FOMC")));
});
