import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Standalone from rejections.test.ts: that file uses `mock.module`, which is unavailable on this
// Node build, so it cannot run locally at all (pre-existing, unrelated to this fix). These checks
// need no mocking, so they live here where they actually execute.

// ─────────────────────────────────────────────────────────────────────────────
// P2 2026-08-07: /admin/zerodte/health reported 0 rejections while /funnel
// reported 146 on the same table in the same second.
// ─────────────────────────────────────────────────────────────────────────────

test("REGRESSION: a pg DATE session_date must reach consumers as ISO, not as a Date's toString", async () => {
  const { isoDateString } = await import("@/lib/db");
  // What node-postgres actually hands back for a DATE column (no setTypeParser override in repo).
  const pgDate = new Date(Date.UTC(2026, 7, 7));

  // The old boundary conversion — String() on a Date — and why the JS filter could never match.
  assert.equal(String(pgDate).slice(0, 15), "Fri Aug 07 2026", "precondition: this is the garbage that was served");
  assert.notEqual(String(pgDate), "2026-08-07");
  // `Date === string` is always false, which is the bug in one line. Routed through an `unknown`
  // binding rather than comparing the Date literal directly: CodeQL's "comparison between
  // inconvertible types" rule fires on the direct form, and it is RIGHT to — that is exactly the
  // defect being demonstrated. Widening first states the same fact without leaving a standing
  // alert that looks like a real one in the security tab.
  const asServed: unknown = pgDate;
  assert.equal(asServed === "2026-08-07", false, "a Date can never equal an ISO string");

  // The boundary now funnels through the repo's documented helper, so the filter is meaningful.
  assert.equal(isoDateString(pgDate), "2026-08-07");
  assert.equal(isoDateString(pgDate) === "2026-08-07", true);
  // Already-ISO strings must pass through untouched — the row shape differs by driver config.
  assert.equal(isoDateString("2026-08-07"), "2026-08-07");
});

test("fetchZeroDteScanRejections normalizes session_date at the db boundary", () => {
  // Source-pinned: exercising it needs a live pool. Every OTHER session_date consumer in db.ts
  // already funnels through isoDateString — this one function was the lone String() outlier, and
  // that inconsistency is what the check guards.
  const src = readFileSync("src/lib/db.ts", "utf8");
  const fnStart = src.indexOf("export async function fetchZeroDteScanRejections");
  assert.ok(fnStart > 0, "precondition: the function must exist");
  const body = src.slice(fnStart, fnStart + 4000);
  assert.match(body, /session_date: isoDateString\(r\.session_date\)/);
  assert.doesNotMatch(body, /session_date: String\(r\.session_date\)/);
});

test("health scopes rejections in SQL rather than fetching a global window and filtering in JS", () => {
  // `limit` applies BEFORE any client-side filter, so an unfiltered fetch can be dominated by other
  // sessions and under-report today's — independent of the date-comparison bug.
  const src = readFileSync("src/lib/admin-zerodte-health.ts", "utf8");
  assert.match(src, /fetchZeroDteRejections\(\{ session_date: sessionDate, limit: REJECTIONS_SAMPLE_LIMIT \}\)/);
});
