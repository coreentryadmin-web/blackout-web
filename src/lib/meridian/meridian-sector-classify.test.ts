import { test, mock } from "node:test";
import assert from "node:assert/strict";

// classifyOne (meridian-sector-classify.ts) dynamic-imports this module per call, so mocking it
// here intercepts that import regardless of the `@/lib/providers/polygon-largo` alias the source
// file spells it with — same convention as src/lib/zerodte/scan.test.ts /
// src/lib/zerodte/exit-sync.test.ts, which mock the same module via this same relative path.
const polyState: {
  calls: string[];
  /** Map from ticker to what this call should do. */
  behavior: Record<string, { status?: number; results?: Record<string, unknown> | null; throw?: string }>;
} = { calls: [], behavior: {} };

mock.module("../providers/polygon-largo", {
  namedExports: {
    fetchPolygonTickerDetails: async (
      ticker: string,
      _signal?: AbortSignal,
      onFailure?: (reason: string) => void
    ) => {
      polyState.calls.push(ticker.toUpperCase());
      const b = polyState.behavior[ticker.toUpperCase()];
      if (!b) throw new Error(`no behavior configured for ${ticker}`);
      if (b.throw != null) {
        onFailure?.(b.throw);
        return null;
      }
      if (b.status != null && b.status >= 300) {
        onFailure?.(`HTTP ${b.status}`);
        return null;
      }
      return { results: b.results ?? undefined };
    },
  },
});

// tsx transpiles tests to CJS (no top-level await) — dynamic-import the module under test
// inside each test, same idiom as skip-grading.test.ts/entry-context.test.ts.
const mod = () => import("./meridian-sector-classify");

// The cache under test is a module-global in-process Map keyed by ticker, shared across every
// test in this file (and, in principle, every other test file sharing the same worker) — so each
// test needs its OWN ticker to avoid a prior test's cached entry making this one a false pass.
let uniq = 0;
const freshTicker = (tag: string) => `ZZ${tag}${(++uniq).toString(36).toUpperCase()}`;

test("classifyTickerSectors: a confirmed HTTP 404 is cached as 'unclassifiable', not retried every build", async () => {
  const { classifyTickerSectors } = await mod();
  const ticker = freshTicker("404");
  polyState.calls.length = 0;
  polyState.behavior[ticker] = { status: 404 };

  const first = await classifyTickerSectors([ticker]);
  assert.equal(polyState.calls.filter((t) => t === ticker).length, 1, "first build makes exactly one upstream call");
  // A confirmed 404 must land in byTicker (an honest "no sector", same shape a 200-with-no-sic_code
  // gets) rather than in `failed` — `failed` is documented as "upstream lookup failed", which a
  // confirmed, permanent 404 is not.
  assert.ok(ticker in first.byTicker, "confirmed-404 ticker is classified (unclassifiable), not listed as failed");
  assert.equal(first.byTicker[ticker]!.majorGroup, null);
  assert.deepEqual(first.failed, []);

  // Second build for the same ticker must hit the cache — this is the regression this test guards:
  // before the fix, a 404 was never cached, so classifyOne (and the upstream call) re-ran on every
  // single build.
  const second = await classifyTickerSectors([ticker]);
  assert.equal(
    polyState.calls.filter((t) => t === ticker).length,
    1,
    "second build must NOT re-call the upstream for a ticker already confirmed 404 — this is the bug (WBS/SOND, 426 repeat 404s/7d in production CloudWatch logs)"
  );
  assert.ok(ticker in second.byTicker);
  assert.equal(second.byTicker[ticker]!.majorGroup, null);
});

test("classifyTickerSectors: a transient failure (5xx) is NOT cached — every build retries it", async () => {
  const { classifyTickerSectors } = await mod();
  const ticker = freshTicker("500");
  polyState.calls.length = 0;
  polyState.behavior[ticker] = { status: 503 };

  const first = await classifyTickerSectors([ticker]);
  assert.deepEqual(first.failed, [ticker], "a non-404 failure lands in `failed`, not byTicker");
  assert.equal(ticker in first.byTicker, false);

  const second = await classifyTickerSectors([ticker]);
  assert.equal(
    polyState.calls.filter((t) => t === ticker).length,
    2,
    "a transient (non-404) failure must be retried on the next build, never frozen into a week of unclassified"
  );
  assert.deepEqual(second.failed, [ticker]);
});

test("classifyTickerSectors: a network-error failure is also NOT cached (same as a 5xx, distinct from a confirmed 404)", async () => {
  const { classifyTickerSectors } = await mod();
  const ticker = freshTicker("NET");
  polyState.calls.length = 0;
  polyState.behavior[ticker] = { throw: "fetch failed: ECONNRESET" };

  await classifyTickerSectors([ticker]);
  await classifyTickerSectors([ticker]);
  assert.equal(
    polyState.calls.filter((t) => t === ticker).length,
    2,
    "a network-error reason string (not literally 'HTTP 404') must never be treated as confirmed-absent"
  );
});

test("classifyTickerSectors: a real 200 with a sic_code still classifies and caches exactly as before (no regression on the happy path)", async () => {
  const { classifyTickerSectors } = await mod();
  const ticker = freshTicker("OK");
  polyState.calls.length = 0;
  polyState.behavior[ticker] = { status: 200, results: { sic_code: "3674", sic_description: "Semiconductors" } };

  const first = await classifyTickerSectors([ticker]);
  assert.equal(first.byTicker[ticker]!.majorGroup, "36");
  assert.equal(first.byTicker[ticker]!.sicDescription, "Semiconductors");

  await classifyTickerSectors([ticker]);
  assert.equal(
    polyState.calls.filter((t) => t === ticker).length,
    1,
    "a genuine classification was already cached before this fix and must remain cached"
  );
});
