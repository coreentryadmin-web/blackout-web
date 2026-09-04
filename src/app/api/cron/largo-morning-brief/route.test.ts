import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression coverage for the largo-morning-brief DST double-fire
// (docs/audit/findings-staging/2026-09-04-largo-morning-brief-dst-double-fire.md).
//
// EventBridge fires this cron TWICE every weekday — 13:25 UTC and 14:25 UTC
// (`schedule_cron_utc: "25 13,14 * * 1-5"` in cron-registry.ts), a dual-band schedule added
// only so cron-staleness-watchdog wouldn't false-alarm across the EDT/EST boundary (ops
// #2565, #2569). Only ONE of the two fires lands on the intended 9:25 ET open — the other is
// a full hour off (8:25 ET under EST, 10:25 ET under EDT). Pre-fix the route had NO ET gate at
// all (unlike its sibling nighthawk-morning-confirm, which uses the same dual-band schedule
// but DOES gate on `inEtWindow`), so BOTH fires ran the full pipeline and pushed a
// duplicate/wrong-time web notification to every opted-in member, every weekday, year-round —
// not only during a DST transition week.
//
// This test proves the ROUTE actually wires its behavior to `inEtWindow`'s verdict: pre-fix,
// the route never imported it at all, so mocking it here to return `false` had no effect and
// the pipeline (and its member push) ran regardless — this test failed RED against the
// pre-fix code (buildCalls stayed 1 instead of 0). Post-fix it passes.

let etWindowResult = true;
let buildCalls = 0;
let loggedRuns: Array<{ jobKey: string; payload: Record<string, unknown> }> = [];

mock.module("../../../../lib/market-api-auth", {
  namedExports: { isCronAuthorized: () => true },
});
mock.module("../../../../features/nighthawk/lib/et-window", {
  namedExports: { inEtWindow: () => etWindowResult },
});
mock.module("../../../../lib/cron-run", {
  namedExports: {
    logCronRun: async (jobKey: string, _started: number, payload: Record<string, unknown>) => {
      loggedRuns.push({ jobKey, payload });
    },
  },
});
mock.module("../../../../lib/largo/morning-brief", {
  namedExports: {
    buildLargoMorningBrief: async () => {
      buildCalls++;
      return { headline: "test", body: "test" };
    },
    formatMorningBriefPush: () => ({ title: "t", body: "b" }),
  },
});
mock.module("../../../../lib/push/send-web-push", {
  namedExports: { sendWebPush: async () => ({ sent: 0 }) },
});
mock.module("../../../../lib/db", {
  namedExports: {
    dbConfigured: () => false,
    dbQuery: async () => ({ rows: [] }),
  },
});

describe("GET /api/cron/largo-morning-brief — ET-window gate on the dual-band schedule", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("outside the 9:25 ET window: no-op — the brief pipeline never runs, no push sent", async () => {
    etWindowResult = false;
    buildCalls = 0;
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/largo-morning-brief"));
    const body = await res.json();

    assert.equal(body.skipped, true, "an off-window fire must report skipped, not run silently");
    assert.equal(buildCalls, 0, "the off-window fire must never build (or push) the brief");
    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0]!.payload.skipped, true);
  });

  test("inside the 9:25 ET window: the pipeline runs normally", async () => {
    etWindowResult = true;
    buildCalls = 0;
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/largo-morning-brief"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(buildCalls, 1, "the in-window fire must build the brief exactly once");
  });

  test("?force=1 bypasses the window gate (manual/agent-driven runs)", async () => {
    etWindowResult = false;
    buildCalls = 0;

    const res = await GET(new NextRequest("http://localhost/api/cron/largo-morning-brief?force=1"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(buildCalls, 1);
  });
});
