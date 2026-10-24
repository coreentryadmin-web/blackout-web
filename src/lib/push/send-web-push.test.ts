import assert from "node:assert/strict";
import { test, mock } from "node:test";

// mock.module MUST use RELATIVE specifiers matching how the module under test imports them —
// tsx's "@/..." alias rewrite only applies to statically-parsed top-level `import ... from`
// statements, not to mock.module()'s own specifier string or to a dynamic import() call (see
// flow-gex-enrichment.test.ts's own comment on this trap). send-web-push.ts imports "@/lib/db"
// (relative: "../db") and dynamically imports "web-push" directly.
let deleteCalls: unknown[][] = [];
let selectRows: Array<{ endpoint: string; p256dh: string; auth: string }> = [];

mock.module("../db.ts", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("DELETE")) {
        deleteCalls.push(params);
        return { rows: [] };
      }
      return { rows: selectRows };
    },
  },
});

// Tracks concurrent in-flight sendNotification calls so the test can prove the fix actually
// parallelizes (old sequential code: max concurrent is always 1) without depending on timing
// of the real network stack.
let inFlight = 0;
let maxInFlight = 0;
const failingEndpoints = new Set<string>();

mock.module("web-push", {
  defaultExport: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // A real delay (not Promise.resolve()) so overlapping calls actually overlap in time —
      // without it every call could resolve on the same microtask tick and never overlap even
      // if the implementation issues them concurrently.
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      if (failingEndpoints.has(sub.endpoint)) {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
      return undefined;
    },
  },
});

function rows(n: number): Array<{ endpoint: string; p256dh: string; auth: string }> {
  return Array.from({ length: n }, (_, i) => ({
    endpoint: `https://push.example/${i}`,
    p256dh: `p256dh-${i}`,
    auth: `auth-${i}`,
  }));
}

test("sendWebPush parallelizes the send loop with bounded concurrency, not sequentially", async () => {
  const prevPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const prevPriv = process.env.VAPID_PRIVATE_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-pub";
  process.env.VAPID_PRIVATE_KEY = "test-priv";
  deleteCalls = [];
  selectRows = rows(12); // more than the 10-concurrency cap, to exercise more than one batch
  inFlight = 0;
  maxInFlight = 0;
  failingEndpoints.clear();

  try {
    const { sendWebPush } = await import("./send-web-push.ts");
    const result = await sendWebPush({ title: "t", body: "b", url: "/u" });

    assert.equal(result.configured, true);
    assert.equal(result.sent, 12, "every subscription should still be sent to exactly once");
    assert.equal(result.pruned, 0);
    // The whole point of the fix: more than one sendNotification call must be in flight at the
    // same time. A sequential `for (...) { await ... }` loop can never exceed 1 here no matter
    // how many rows there are — this is the regression this test exists to catch.
    assert.ok(
      maxInFlight > 1,
      `expected overlapping sends (bounded concurrency), got max concurrent = ${maxInFlight}`
    );
    // Bounded, not unbounded — never more in flight than the worker-pool size.
    assert.ok(maxInFlight <= 10, `expected concurrency capped at 10, got ${maxInFlight}`);
  } finally {
    if (prevPub === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevPub;
    if (prevPriv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = prevPriv;
  }
});

test("sendWebPush still prunes stale (404/410) subscriptions correctly under concurrent sends", async () => {
  const prevPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const prevPriv = process.env.VAPID_PRIVATE_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-pub";
  process.env.VAPID_PRIVATE_KEY = "test-priv";
  deleteCalls = [];
  const live = rows(8);
  selectRows = live;
  inFlight = 0;
  maxInFlight = 0;
  failingEndpoints.clear();
  failingEndpoints.add(live[2]!.endpoint);
  failingEndpoints.add(live[5]!.endpoint);

  try {
    const { sendWebPush } = await import("./send-web-push.ts");
    const result = await sendWebPush({ title: "t", body: "b", url: "/u" });

    assert.equal(result.sent, 6);
    assert.equal(result.pruned, 2);
    assert.equal(deleteCalls.length, 1, "pruning issues one DELETE after the send loop completes");
    const prunedEndpoints = deleteCalls[0]![0] as string[];
    assert.deepEqual(
      [...prunedEndpoints].sort(),
      [live[2]!.endpoint, live[5]!.endpoint].sort()
    );
  } finally {
    if (prevPub === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevPub;
    if (prevPriv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = prevPriv;
  }
});
