import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// REGRESSION (round 331): `admin-critical-alerts.ts`'s `bootstrapSeenFromDb()` used to guard
// its once-per-process DB hydration with a plain boolean flipped to `true` BEFORE the
// `await dbQuery(...)` it was meant to gate ever resolved. That stops a second concurrent
// caller from starting a second query, but does not make it WAIT for the first — a call that
// reaches the synchronous `if (seenBootstrapped) return` check while the first call's query is
// still in flight returns immediately with `seenCritical` still empty, skipping hydration
// entirely rather than merely skipping a redundant read.
//
// `GET /api/admin/health` calls `maybeAlertCriticalIssues` on every load, so two
// near-simultaneous admin loads right after a process restart (two tabs, or one admin's
// auto-refresh racing a slow DB pool) both pass the gate before either sees the persisted
// `admin_incidents` fingerprints — whichever call's `fresh` filter runs first then treats an
// issue that was already alerted within the last 24 hours (pre-restart) as brand new and
// re-fires a duplicate Discord "SPX CRITICAL" alert.
//
// Fake `dbQuery` below resolves on a macrotask tick (like a real Postgres round trip) so two
// concurrent `maybeAlertCriticalIssues` calls genuinely overlap — the same interleaving
// `thermal-discord-breach-lock-concurrency.test.ts` uses for its own lost-update race.

type FakeIssue = { id: string; severity: "critical" | "warning" | "info"; title: string; detail: string };

let dbQueryCalls = 0;
let dbConfiguredValue = true;
let persistedFingerprints: string[] = [];
const notifiedTitles: string[] = [];

mock.module("./db", {
  namedExports: {
    dbConfigured: (): boolean => dbConfiguredValue,
    dbQuery: async <T>(_sql: string): Promise<{ rows: T[] }> => {
      dbQueryCalls += 1;
      // Force a real async gap (like a real Postgres round trip) so a second concurrent
      // call's synchronous `if (seenBootstrapped) return` check runs WHILE this is in flight —
      // the exact interleaving that drops the bootstrap under the old plain-boolean guard.
      await new Promise((r) => setTimeout(r, 10));
      return { rows: persistedFingerprints.map((fingerprint) => ({ fingerprint })) as T[] };
    },
  },
});

mock.module("../features/spx/lib/spx-play-notify", {
  namedExports: {
    notifyOpsDiscord: async (opts: { title: string }): Promise<void> => {
      notifiedTitles.push(opts.title);
    },
  },
});

async function loadModule() {
  return import("./admin-critical-alerts.ts");
}

describe("admin-critical-alerts bootstrap concurrency (maybeAlertCriticalIssues)", () => {
  it("two concurrent calls right after restart must NOT re-alert an issue already persisted as seen", async () => {
    const { maybeAlertCriticalIssues } = await loadModule();
    dbQueryCalls = 0;
    dbConfiguredValue = true;
    notifiedTitles.length = 0;
    // The issue below was already alerted pre-restart — the DB bootstrap exists specifically
    // so a fresh in-memory `seenCritical` Map doesn't treat it as new again.
    persistedFingerprints = ["gex:GEX feed degraded"];

    const issue: FakeIssue = {
      id: "gex:GEX feed degraded",
      severity: "critical",
      title: "GEX feed degraded",
      detail: "stale > 10m",
    };

    const [freshA, freshB] = await Promise.all([
      maybeAlertCriticalIssues([issue] as never),
      maybeAlertCriticalIssues([issue] as never),
    ]);

    // Under the old plain-boolean guard, call B's synchronous check passed while call A's
    // dbQuery was still resolving, so B saw an EMPTY seenCritical and alerted — this assertion
    // is exactly what distinguishes the fix from the bug (reproduces 1 >= 0 pre-fix).
    assert.equal(freshA + freshB, 0, "an already-persisted critical issue must never be re-alerted by either concurrent call");
    assert.equal(notifiedTitles.length, 0, "no duplicate Discord alert should have fired");
    assert.equal(dbQueryCalls, 1, "the bootstrap query must be single-flighted across concurrent callers, not run twice");
  });

  it("a genuinely new critical issue still alerts exactly once across concurrent calls", async () => {
    const { maybeAlertCriticalIssues } = await loadModule();
    dbQueryCalls = 0;
    dbConfiguredValue = true;
    notifiedTitles.length = 0;
    persistedFingerprints = [];

    const issue: FakeIssue = {
      id: "redis:Redis degraded",
      severity: "critical",
      title: "Redis degraded",
      detail: "connection refused",
    };

    const [freshA, freshB] = await Promise.all([
      maybeAlertCriticalIssues([issue] as never),
      maybeAlertCriticalIssues([issue] as never),
    ]);

    assert.equal(freshA + freshB, 1, "a real new critical issue must be reported fresh exactly once total");
    assert.equal(notifiedTitles.length, 1, "exactly one Discord alert should have fired");
  });
});
