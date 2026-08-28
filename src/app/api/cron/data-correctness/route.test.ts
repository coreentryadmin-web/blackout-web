import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression coverage for the duplicate "Data-correctness FLAG" Discord alert (caught live in
// #website-logs, docs/audit/findings-staging/2026-08-28-data-correctness-force-sweep-debounce.md):
// this route has exactly one registered EventBridge cron, and it uses the SYNCHRONOUS path (no
// ?force=1) — the async-full branch below is reached only via manual/agent-driven ?force=1 calls,
// and with multiple independent fleet lane sessions each running their own health checks against
// the same production endpoint, two calls landing seconds apart used to dispatch two full,
// independent sweeps, each posting its own Discord alert on the same underlying flags.

let cronAuthorized = true;
let claimAcquired = true;
let claimCalls: Array<{ key: string; ttlSec: number }> = [];
let notifyCalls: Array<{ title: string }> = [];
let loggedRuns: Array<{ jobKey: string; payload: Record<string, unknown> }> = [];

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    isCronAuthorized: () => cronAuthorized,
  },
});
mock.module("../../../../features/spx/lib/spx-play-session-guards", {
  namedExports: {
    isSpxEngineCronWindow: () => true,
  },
});
mock.module("../../../../lib/cron-run", {
  namedExports: {
    logCronRun: async (jobKey: string, _started: number, payload: Record<string, unknown>) => {
      loggedRuns.push({ jobKey, payload });
    },
  },
});
mock.module("../../../../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async (opts: { title: string }) => {
      notifyCalls.push({ title: opts.title });
    },
  },
});
mock.module("../../../../lib/shared-cache", {
  namedExports: {
    sharedCacheSetNx: async (key: string, _value: unknown, ttlSec: number) => {
      claimCalls.push({ key, ttlSec });
      return claimAcquired;
    },
  },
});
mock.module("../../../../lib/correctness/run-correctness", {
  namedExports: {
    runFullCorrectness: async () => ({
      surface: "platform",
      marketOpen: true,
      ranAt: new Date().toISOString(),
      totals: { consistencyOnly: 0, independentlyConfirmed: 1 },
      flags: [{ layer: "cross-provider", metric: "strike", detail: "TEST flag" }],
      coverageGaps: [],
    }),
    runHeatmapCorrectness: async () => ({
      surface: "heatmap",
      marketOpen: true,
      ranAt: new Date().toISOString(),
      totals: { consistencyOnly: 0, independentlyConfirmed: 1 },
      flags: [],
      coverageGaps: [],
    }),
    correctnessTickers: () => ["SPX"],
    renderScorecardMarkdown: () => "",
    scorecardStatus: () => "flag",
  },
});

async function flushBackgroundWork() {
  // `after()` isn't invoked in the Node test runtime the same way it is under the Next.js
  // request lifecycle, so the route falls back to its synchronous dispatch — but the sweep
  // itself is still an async IIFE; give its microtasks a tick to complete before asserting.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("GET /api/cron/data-correctness — force-sweep debounce", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("acquires the lock and dispatches a sweep on the first ?force=1 call", async () => {
    claimAcquired = true;
    claimCalls = [];
    notifyCalls = [];
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/data-correctness?force=1"));
    const body = await res.json();

    assert.equal(res.status, 202);
    assert.equal(body.status, "accepted");
    assert.equal(claimCalls.length, 1, "must attempt the NX claim exactly once");
    assert.equal(claimCalls[0]!.key, "cron:data-correctness:force-sweep-lock");
    assert.ok(claimCalls[0]!.ttlSec > 0 && claimCalls[0]!.ttlSec <= 120, "lock TTL should be a short debounce window");

    await flushBackgroundWork();
    assert.equal(notifyCalls.length, 1, "the dispatched sweep should still post its one alert");
  });

  test("a second concurrent ?force=1 call is debounced — no second sweep, no second alert", async () => {
    claimAcquired = false; // simulates another caller already holding the lock
    claimCalls = [];
    notifyCalls = [];
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/data-correctness?force=1"));
    const body = await res.json();

    assert.equal(res.status, 202);
    assert.equal(body.status, "debounced");
    assert.match(String(body.reason), /already in flight|completed within/);

    await flushBackgroundWork();
    assert.equal(notifyCalls.length, 0, "a debounced call must never dispatch a sweep or post a duplicate alert");
    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0]!.payload.status, "debounced");

    claimAcquired = true;
  });

  test("?surface=heatmap (the synchronous targeted path) is unaffected by the lock", async () => {
    claimAcquired = false; // even if a full sweep's lock is held, the surface-scoped path must proceed
    claimCalls = [];
    notifyCalls = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/data-correctness?force=1&surface=heatmap"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.surface, "heatmap");
    assert.equal(claimCalls.length, 0, "the lock only guards the async-full dispatch branch");

    claimAcquired = true;
  });
});
