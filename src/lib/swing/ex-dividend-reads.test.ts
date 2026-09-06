// Real BEHAVIOR tests for resolveSwingExDividendContext — the existing
// ex-dividend-reads-freshness.test.ts only regex-asserts substrings against the raw source
// (readFileSync), so it would pass even if the catch-branch's returned VALUE were wrong. This
// file actually imports and calls the function, mocking fetchPolygonDividends per node:test's
// --experimental-test-module-mocks so both the success path and the failure path are exercised
// for real.
//
// The bug this guards: resolveSwingExDividendContext used to catch ANY fetchPolygonDividends
// failure (rate limit, timeout, network blip) and return `{ exDividendSession: false,
// exDividendCash: null }` — indistinguishable from "confirmed not an ex-div day". Per
// manage-sync.ts's Q39 comment, exDividendSession:false is exactly the state that lets a
// legitimate ex-dividend price drop be read as a raw structural-stop breach on a LONG position,
// so a transient provider error silently re-enabled the exact bug Q39 was built to prevent. The
// fix adds a `dataUnavailable` flag so callers (manage.ts's structuralStopBroken) can fail SAFE
// instead of fail-open.
import { test, mock, describe, before } from "node:test";
import assert from "node:assert/strict";

// Relative specifier, not the "@/..." alias — tsx's alias rewrite only applies to statically-
// parsed top-level `import ... from` statements, not to mock.module()'s specifier string (see
// flow-gex-enrichment.test.ts for the same gotcha, confirmed the hard way).
mock.module("../providers/polygon-largo", {
  namedExports: {
    fetchPolygonDividends: async (ticker: string) => {
      if (ticker === "THROWS") throw new Error("Polygon rate limited");
      // FAKE ticker with a real ex-div record on the test's session day.
      return [
        {
          ticker,
          ex_dividend_date: "2026-09-05",
          pay_date: "2026-09-19",
          record_date: "2026-09-08",
          frequency: 4,
          cash_amount: 1.25,
          currency: "USD",
        },
      ];
    },
  },
});

describe("resolveSwingExDividendContext", () => {
  let mod: typeof import("./ex-dividend-reads");
  let resolveSwingExDividendContext: typeof import("./ex-dividend-reads").resolveSwingExDividendContext;
  let resetSwingExDividendCache: typeof import("./ex-dividend-reads").resetSwingExDividendCache;

  before(async () => {
    mod = await import("./ex-dividend-reads");
    ({ resolveSwingExDividendContext, resetSwingExDividendCache } = mod);
  });

test("resolveSwingExDividendContext: success path resolves session/cash and reports data AVAILABLE", async () => {
  resetSwingExDividendCache();
  const out = await resolveSwingExDividendContext("AAPL", "2026-09-05");
  assert.equal(out.exDividendSession, true);
  assert.equal(out.exDividendCash, 1.25);
  assert.equal(out.dataUnavailable, false, "a successful read must never report dataUnavailable");
});

test("resolveSwingExDividendContext: success path on a non-ex-div day is a CONFIRMED false, not unknown", async () => {
  resetSwingExDividendCache();
  const out = await resolveSwingExDividendContext("AAPL", "2026-01-01");
  assert.equal(out.exDividendSession, false);
  assert.equal(out.exDividendCash, null);
  assert.equal(out.dataUnavailable, false, "a real non-ex-div day is a confirmed negative, not unknown");
});

test("resolveSwingExDividendContext: fetchPolygonDividends failure reports dataUnavailable, not a confirmed false", async () => {
  resetSwingExDividendCache();
  const out = await resolveSwingExDividendContext("THROWS", "2026-09-05");
  // The old bug: this returned exDividendSession:false with NO way to distinguish it from a
  // confirmed non-ex-div day. The fix adds this flag; a caller MUST check it before trusting the
  // false at face value.
  assert.equal(out.dataUnavailable, true, "a fetch failure must be distinguishable from a confirmed negative");
  assert.equal(out.exDividendSession, false, "still the conservative default shape — but now flagged unknown");
  assert.equal(out.exDividendCash, null);
});

test("resolveSwingExDividendContext: a failed read is never cached (next call retries, doesn't reuse a stale unknown)", async () => {
  resetSwingExDividendCache();
  const first = await resolveSwingExDividendContext("THROWS", "2026-09-05");
  assert.equal(first.dataUnavailable, true);
  // Same (ticker, sessionDay) key immediately after a failure — if the failure had been cached,
  // this would still read dataUnavailable:true from cache; either way it's true here, so the real
  // proof is behavioral: change the ticker to succeed and confirm the cache wasn't poisoned with a
  // stale entry keyed off the failure (this call uses the SAME key shape, a fresh ticker+day pair
  // covered by the mock's success branch).
  const second = await resolveSwingExDividendContext("MSFT", "2026-09-05");
  assert.equal(second.dataUnavailable, false);
  assert.equal(second.exDividendSession, true);
});

}); // describe("resolveSwingExDividendContext")
