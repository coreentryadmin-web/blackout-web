import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression: a self-heal re-warm that FAILS must be visible in a DURABLE, queryable record —
// not just a console.error line in raw CloudWatch.
//
// `runSelfHeal` computes a per-job `res` (ok/status/error/detail) for each stale cron it
// re-warms, but the original code only `console[...]`-logged it and never pushed the result into
// the `healed` array the route declared specifically to carry it — so the array stayed `[]`
// forever. Worse, self-heal is deliberately dispatched via Next's `after()` so it runs AFTER this
// route's own HTTP response is already serialized (see the route's own comment on why: several
// warmers run in sequence can exceed Cloudflare's ~100s origin timeout otherwise). That means the
// `result` object this route builds and persists via `logCronRun` is *always* constructed and
// written before the background self-heal work has even started running — so even a correctly
// populated `healed` array could never reach that already-persisted row. Either way, an operator
// reading `cron_job_runs` (rather than grepping live ECS logs) saw `self_healed: []` / `ok:true`
// on the watchdog's own run regardless of whether the dispatched re-warm actually succeeded.
//
// Fix: persist a SECOND, distinctly-keyed `cron_job_runs` row once the background self-heal work
// actually settles, carrying the real per-job outcome — verified below by mocking a self-heal
// dispatch to FAIL and asserting that failure lands in that follow-up row (not just nowhere).

let cronAuthorized = true;
let dispatchResult: { ok: boolean; status: number; error?: string; detail?: string } = {
  ok: true,
  status: 200,
};
let dispatchCalls: string[] = [];
let loggedRuns: Array<{ jobKey: string; payload: Record<string, unknown> }> = [];
let staleJob: Record<string, unknown> | null = null;

function baseJob(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    key: "flow-ingest",
    name: "Flow Ingest",
    kind: "warmer",
    path: "/api/cron/flow-ingest",
    schedule_label: "*/5 11-21 * * 1-5",
    description: "test job",
    status: "stale",
    status_label: "STALE",
    market_hours_stale: true,
    last_run_at: null,
    last_status: null,
    last_duration_ms: null,
    last_message: null,
    age_min: 12,
    stale_after_min: 5,
    effective_stale_min: 5,
    stale_multiplier: 1,
    runs_24h: { ok: 0, failed: 0, skipped: 0 },
    ...overrides,
  };
}

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    isCronAuthorized: () => cronAuthorized,
  },
});
mock.module("../../../../lib/admin-cron-health", {
  namedExports: {
    buildCronHealthSnapshot: async () => ({
      jobs: staleJob ? [staleJob] : [],
      db_snapshot_error: null,
    }),
  },
});
mock.module("../../../../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async () => true,
  },
});
mock.module("../../../../lib/cron-run", {
  namedExports: {
    logCronRun: async (jobKey: string, _started: number, payload: Record<string, unknown>) => {
      loggedRuns.push({ jobKey, payload });
    },
  },
});
mock.module("../../../../lib/cron-dispatch", {
  namedExports: {
    isDispatchableCron: () => true,
    dispatchCronWarm: async (key: string) => {
      dispatchCalls.push(key);
      return { name: key, ranAt: new Date().toISOString(), durationMs: 5, ...dispatchResult };
    },
  },
});
mock.module("../../../../lib/error-sink", {
  namedExports: {
    countRecentErrorEvents: async () => ({ total: 0, groups: [] }),
    classifyErrorSpike: () => "none" as const,
  },
});
mock.module("../../../../features/nighthawk/lib/edition-stale", {
  namedExports: {
    isInEditionWindow: () => false,
  },
});

async function flushBackgroundWork() {
  // Same reasoning as data-correctness/route.test.ts: outside a real Next.js request scope,
  // calling `after()` throws, so the route's own `catch { dispatchHeal(); }` fallback runs the
  // dispatch directly — but `dispatchHeal` itself only fires-and-forgets (`void runSelfHeal(...)`),
  // so its internal awaits still need a tick (or several, for a multi-job loop) to settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("GET /api/cron/cron-staleness-watchdog — self-heal outcome persistence", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    process.env.CRON_WATCHDOG_SELF_HEAL = "1";
    ({ GET } = await import("./route"));
  });

  test("a FAILED self-heal dispatch is recorded, ok:false, in a durable follow-up row", async () => {
    staleJob = baseJob({});
    dispatchResult = { ok: false, status: 500, error: "boom" };
    dispatchCalls = [];
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/cron-staleness-watchdog"));
    const body = await res.json();

    assert.equal(res.status, 200);
    // The synchronous response must not claim a settled, empty self-heal outcome — that reads as
    // "self-heal ran and healed nothing" when in truth it hasn't finished (or even started) yet.
    assert.equal(body.self_heal_dispatched.length, 1);
    assert.equal(body.self_heal_dispatched[0], "flow-ingest");
    assert.equal(body.self_healed, null, "outcome is not yet known synchronously — must not be reported as []");
    assert.equal(body.self_heal_log_key, "cron-staleness-watchdog-self-heal");

    await flushBackgroundWork();

    assert.deepEqual(dispatchCalls, ["flow-ingest"], "the stale job must actually be dispatched");

    // The real, settled outcome must land in a SECOND, distinctly-keyed row — this is the durable
    // record an operator (or a future audit) reads from `cron_job_runs`.
    const followUp = loggedRuns.find((r) => r.jobKey === "cron-staleness-watchdog-self-heal");
    assert.ok(followUp, "a follow-up cron_job_runs row must exist for the self-heal outcome");
    assert.equal(followUp!.payload.ok, false, "the row must reflect the real FAILURE, not a false ok:true");
    assert.deepEqual(followUp!.payload.dispatched, ["flow-ingest"]);
    const healed = followUp!.payload.healed as Array<{ key: string; ok: boolean; status: number; detail?: string }>;
    assert.equal(healed.length, 1);
    assert.equal(healed[0]!.key, "flow-ingest");
    assert.equal(healed[0]!.ok, false);
    assert.equal(healed[0]!.status, 500);
    assert.equal(healed[0]!.detail, "boom");

    // The main watchdog run's OWN row (same key as every other tick) must still exist, separate
    // from the self-heal follow-up — the fix must not repurpose or overwrite it.
    const mainRun = loggedRuns.find((r) => r.jobKey === "cron-staleness-watchdog");
    assert.ok(mainRun, "the watchdog's own per-tick row must still be logged");
  });

  test("a SUCCESSFUL self-heal dispatch is also recorded in the follow-up row, ok:true", async () => {
    staleJob = baseJob({});
    dispatchResult = { ok: true, status: 200 };
    dispatchCalls = [];
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/cron-staleness-watchdog"));
    assert.equal(res.status, 200);

    await flushBackgroundWork();

    const followUp = loggedRuns.find((r) => r.jobKey === "cron-staleness-watchdog-self-heal");
    assert.ok(followUp);
    assert.equal(followUp!.payload.ok, true);
    const healed = followUp!.payload.healed as Array<{ key: string; ok: boolean; status: number }>;
    assert.equal(healed.length, 1);
    assert.equal(healed[0]!.ok, true);
    assert.equal(healed[0]!.status, 200);
  });

  test("no stale jobs => no self-heal follow-up row is written, and self_healed reports []", async () => {
    staleJob = null;
    dispatchCalls = [];
    loggedRuns = [];

    const res = await GET(new NextRequest("http://localhost/api/cron/cron-staleness-watchdog"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.self_heal_dispatched, []);
    assert.deepEqual(body.self_healed, [], "nothing was dispatched, so [] is the honest answer here");
    assert.equal(body.self_heal_log_key, null);

    await flushBackgroundWork();

    assert.deepEqual(dispatchCalls, [], "nothing should be dispatched when no job is stale");
    assert.equal(
      loggedRuns.find((r) => r.jobKey === "cron-staleness-watchdog-self-heal"),
      undefined,
      "no follow-up row should be written when self-heal never ran"
    );
  });
});
