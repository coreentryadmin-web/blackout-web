import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowAlert } from "@/lib/api";
import { earningsDayDiffEt, compareFlowAlertsByTimeAsc } from "./FlowFeed";

/**
 * Regression tests for two date/time-handling bugs fixed 2026-09-04, both in FlowFeed.tsx.
 *
 * Bug 1 — `earningsDayDiffEt` (feeds `earningsDays` → `ctx.earnIn` → the EARN/E{n}D badge in
 * `flowSignals`, helix-flow-format.ts): the previous inline computation built both endpoints via
 * `new Date()`/`new Date(dateStr + "T00:00:00")` + `.setHours(0,0,0,0)`, which per ECMA-262
 * resolves in the BROWSER'S LOCAL timezone, not America/New_York — but `earningsMap`'s report
 * dates (from `fetchEarningsCalendar()`) are ET trading-calendar dates, the same convention
 * Meridian's `report_date` uses. A member off ET could get an off-by-one day diff for the hours
 * around either midnight where the local calendar day and the ET calendar day disagree.
 *
 * Bug 2 — `compareFlowAlertsByTimeAsc` (used by `startReplay()`'s tape sort): the previous inline
 * comparator was raw `new Date(a.alerted_at).getTime() - new Date(b.alerted_at).getTime()`.
 * `flow-persist.ts` documents that a freshly-streamed SSE row can carry `alerted_at: ""` when the
 * real UW print time is unknown, and the merge path keeps such rows in `alerts`.
 * `new Date("").getTime()` is `NaN`, so any comparison involving that row returned NaN — an
 * `Array.prototype.sort` comparator-contract violation (unspecified/engine-dependent ordering) —
 * unlike the null-safe `flowTimeMs`-based sort `displayAlerts` a few lines below already uses for
 * this exact failure shape.
 */

const alert = (over: Partial<FlowAlert>): FlowAlert =>
  ({
    alert_id: "x",
    ticker: "SPX",
    strike: 6000,
    option_type: "CALL",
    premium: 1_000_000,
    expiry: "2026-09-19",
    alerted_at: "2026-09-04T14:00:00Z",
    ...over,
  }) as FlowAlert;

// ── Bug 1: earningsDayDiffEt ───────────────────────────────────────────────────────────────────

test("earningsDayDiffEt: same ET calendar date diffs to 0", () => {
  const now = new Date("2026-09-04T18:00:00Z"); // 14:00 ET
  assert.equal(earningsDayDiffEt("2026-09-04", now), 0);
});

test("earningsDayDiffEt: 5 ET calendar days out diffs to 5", () => {
  const now = new Date("2026-09-04T18:00:00Z");
  assert.equal(earningsDayDiffEt("2026-09-09", now), 5);
});

test("earningsDayDiffEt: does NOT clamp a past report date to 0 (unlike daysToExpiry)", () => {
  const now = new Date("2026-09-04T18:00:00Z");
  assert.equal(earningsDayDiffEt("2026-09-03", now), -1);
});

test("earningsDayDiffEt: THE BUG — West Coast member past ET midnight, before the fix would read 1 not 0", () => {
  // 2026-09-04T22:00:00-07:00 PT == 2026-09-05T01:00:00-04:00 ET: the ET trading day has ALREADY
  // rolled to 2026-09-05, the ticker's real report date. The old local-midnight computation (see
  // the bug's own reproduction in the PR) diffed this as 1 day away; the ET-anchored fix reads 0 —
  // the print is happening TODAY in ET terms, exactly where the EARN (not E1D) badge belongs.
  const now = new Date("2026-09-04T22:00:00-07:00");
  assert.equal(earningsDayDiffEt("2026-09-05", now), 0);
});

test("earningsDayDiffEt: reverse case — a zone AHEAD of ET whose local calendar date has rolled but ET's hasn't", () => {
  // 2026-09-05T02:00:00+02:00 CEST == 2026-09-05T00:00:00 UTC == 2026-09-04T20:00:00-04:00 ET: the
  // ET trading day is STILL 2026-09-04, even though this zone's local calendar has already rolled
  // to 09-05. A naive local-Date computation targeting "2026-09-05" would read 0 days away
  // (today, in the wrong calendar); the ET-anchored fix correctly reads 1 (tomorrow, in ET).
  const now = new Date("2026-09-05T02:00:00+02:00");
  assert.equal(earningsDayDiffEt("2026-09-05", now), 1);
});

test("earningsDayDiffEt: is timezone-invariant — same real instant, three different runtime TZs agree", () => {
  const instant = "2026-09-04T22:00:00-07:00"; // same real moment, phrased in PT
  const sameInstantUtc = new Date(Date.parse(instant));
  for (const tz of ["America/Los_Angeles", "America/New_York", "Europe/Berlin", "UTC"]) {
    const prevTz = process.env.TZ;
    process.env.TZ = tz;
    try {
      assert.equal(
        earningsDayDiffEt("2026-09-05", sameInstantUtc),
        0,
        `expected 0 under runtime TZ=${tz}`
      );
    } finally {
      process.env.TZ = prevTz;
    }
  }
});

test("earningsDayDiffEt: invalid date string returns NaN, never a false 0", () => {
  const now = new Date("2026-09-04T18:00:00Z");
  assert.ok(Number.isNaN(earningsDayDiffEt("not-a-date", now)));
});

// ── Bug 2: compareFlowAlertsByTimeAsc ──────────────────────────────────────────────────────────

test("compareFlowAlertsByTimeAsc: dated rows sort strictly ascending (oldest first)", () => {
  const rows = [
    alert({ alert_id: "new", alerted_at: "2026-09-04T16:00:00Z" }),
    alert({ alert_id: "old", alerted_at: "2026-09-04T10:00:00Z" }),
    alert({ alert_id: "mid", alerted_at: "2026-09-04T13:00:00Z" }),
  ];
  const sorted = [...rows].sort(compareFlowAlertsByTimeAsc);
  assert.deepEqual(sorted.map((r) => r.alert_id), ["old", "mid", "new"]);
});

test("compareFlowAlertsByTimeAsc: an undated row (alerted_at: \"\") does not throw and lands deterministically last", () => {
  const rows = [
    alert({ alert_id: "old", alerted_at: "2026-09-04T10:00:00Z" }),
    alert({ alert_id: "undated", alerted_at: "" }),
    alert({ alert_id: "new", alerted_at: "2026-09-04T16:00:00Z" }),
  ];
  // Pre-fix (raw `new Date(a.alerted_at).getTime() - new Date(b.alerted_at).getTime()`), any
  // comparison touching "undated" is NaN and Array.prototype.sort's placement of it is
  // unspecified — this assertion is exactly what that non-determinism would fail.
  const sorted = [...rows].sort(compareFlowAlertsByTimeAsc);
  assert.deepEqual(sorted.map((r) => r.alert_id), ["old", "new", "undated"]);
});

test("compareFlowAlertsByTimeAsc: multiple undated rows keep a stable relative order and dated rows stay ordered around them", () => {
  const rows = [
    alert({ alert_id: "u1", alerted_at: "" }),
    alert({ alert_id: "old", alerted_at: "2026-09-04T10:00:00Z" }),
    alert({ alert_id: "u2", alerted_at: "" }),
    alert({ alert_id: "new", alerted_at: "2026-09-04T16:00:00Z" }),
  ];
  const sorted = [...rows].sort(compareFlowAlertsByTimeAsc);
  assert.deepEqual(sorted.map((r) => r.alert_id), ["old", "new", "u1", "u2"]);
});

test("compareFlowAlertsByTimeAsc: an unparseable timestamp is treated the same as an absent one", () => {
  const rows = [
    alert({ alert_id: "junk", alerted_at: "not-a-time" }),
    alert({ alert_id: "old", alerted_at: "2026-09-04T10:00:00Z" }),
  ];
  const sorted = [...rows].sort(compareFlowAlertsByTimeAsc);
  assert.deepEqual(sorted.map((r) => r.alert_id), ["old", "junk"]);
});

test("compareFlowAlertsByTimeAsc: an all-undated tape does not throw and preserves relative order", () => {
  const rows = [alert({ alert_id: "x", alerted_at: "" }), alert({ alert_id: "y", alerted_at: "" })];
  const sorted = [...rows].sort(compareFlowAlertsByTimeAsc);
  assert.deepEqual(sorted.map((r) => r.alert_id), ["x", "y"]);
});
