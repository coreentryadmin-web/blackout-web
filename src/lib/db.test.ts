import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapAlertAuditTrailRow } from "./db";

test("mapAlertAuditTrailRow: converts NUMERIC confidence_score (a string from node-pg) to a real number", () => {
  const row = mapAlertAuditTrailRow({
    id: "42",
    alert_type: "zerodte",
    ticker: "nvda",
    direction: "long",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: "82.5",
    confidence_label: "high",
    trigger_reason: "aggression spike",
    outcome: "target",
  });
  assert.equal(row.id, 42);
  assert.equal(typeof row.confidence_score, "number");
  assert.equal(row.confidence_score, 82.5);
});

test("mapAlertAuditTrailRow: null direction/confidence/trigger_reason/outcome stay null, not 'null' strings", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "nighthawk_rejected",
    ticker: "TSLA",
    direction: null,
    fired_at: "2026-07-01T00:00:00.000Z",
    confidence_score: null,
    confidence_label: null,
    trigger_reason: null,
    outcome: null,
  });
  assert.equal(row.direction, null);
  assert.equal(row.confidence_score, null);
  assert.equal(row.confidence_label, null);
  assert.equal(row.trigger_reason, null);
  assert.equal(row.outcome, null);
});

test("mapAlertAuditTrailRow: fired_at normalizes to an ISO string regardless of the driver's returned format", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "zerodte",
    ticker: "SPY",
    direction: "short",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: 50,
    confidence_label: "medium",
    trigger_reason: null,
    outcome: "pending",
  });
  assert.equal(row.fired_at, "2026-07-01T14:30:00.000Z");
});

test("fetchNighthawkOutcomeAnalytics: day-window filter uses the ET-safe date, not bare Postgres CURRENT_DATE", () => {
  // Regression guard for a bug that has now recurred twice: CURRENT_DATE evaluates in the
  // server's UTC session, so it rolls over 5 (EDT) or 4 (EST) hours before ET midnight,
  // shifting this window a day early for the whole 8pm-midnight ET stretch. The same class
  // of bug was already found and fixed once in confluence-outcomes.ts; this asserts the
  // nighthawk_play_outcomes query can't silently regress back to the bare form a third time.
  const source = readFileSync(join(__dirname, "db.ts"), "utf8");
  const fnStart = source.indexOf("export async function fetchNighthawkOutcomeAnalytics");
  assert.ok(fnStart >= 0, "fetchNighthawkOutcomeAnalytics not found in db.ts");
  const fnBody = source.slice(fnStart, fnStart + 2000);
  assert.match(fnBody, /\(NOW\(\) AT TIME ZONE 'America\/New_York'\)::date/);
  assert.doesNotMatch(fnBody, /\bCURRENT_DATE\b/);
});
