import test from "node:test";
import assert from "node:assert/strict";
import { fetchMarketIndices, fetchNightHawkPlays } from "./api.ts";

/**
 * Regression coverage for the "already using a feature, gets a mid-session timeout, has to
 * refresh" symptom. Root cause: neither marketFetch (backs nearly every /api/market/* desk hook)
 * nor intelFetch (backs /api/engine/*) made any attempt to recover from a 401 — a stale session
 * token just threw immediately and stranded the calling SWR hook in an error/degraded state with
 * no automatic retry, even though Clerk's own client SDK would have refreshed the token moments
 * later on its own background timer. These tests pin the fix: ONE silent
 * `window.Clerk.session.getToken({ skipCache: true })` refresh + retry before a 401 becomes
 * terminal, and confirm it never retries more than once (a second 401 after a successful refresh
 * means the session is genuinely gone, not transiently stale).
 */

type FakeResponseInit = { status: number; ok: boolean; body: unknown };

function fakeResponse({ status, ok, body }: FakeResponseInit): Response {
  return {
    status,
    ok,
    json: async () => body,
  } as unknown as Response;
}

function withFakeBrowserGlobals<T>(
  opts: { getToken?: (options?: { skipCache?: boolean }) => Promise<string | null>; noClerk?: boolean; noWindow?: boolean },
  run: () => Promise<T>
): Promise<T> {
  const originalWindow = globalThis.window;
  if (opts.noWindow) {
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  } else {
    const windowValue: { Clerk?: unknown } = {};
    if (!opts.noClerk) {
      windowValue.Clerk = {
        session: { getToken: opts.getToken ?? (async () => "fresh-token") },
      };
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  }
  return run().finally(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  });
}

function withFakeFetch<T>(impl: (...args: Parameters<typeof fetch>) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test("marketFetch: a 401 triggers one silent Clerk refresh and a successful retry", async () => {
  let fetchCalls = 0;
  let getTokenCalls = 0;
  const result = await withFakeBrowserGlobals(
    {
      getToken: async (opts) => {
        getTokenCalls += 1;
        assert.deepEqual(opts, { skipCache: true }, "must force a fresh token, not the cached one");
        return "fresh-token";
      },
    },
    () =>
      withFakeFetch(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return fakeResponse({ status: 401, ok: false, body: null });
        return fakeResponse({ status: 200, ok: true, body: { spx: null, vix: null, source: "test", as_of: "now" } });
      }, () => fetchMarketIndices())
  );
  assert.equal(fetchCalls, 2, "must retry exactly once after a successful refresh");
  assert.equal(getTokenCalls, 1, "must attempt exactly one silent refresh");
  assert.ok(result);
});

test("marketFetch: a second 401 after a successful refresh is terminal, never retried again", async () => {
  let fetchCalls = 0;
  let getTokenCalls = 0;
  await assert.rejects(
    () =>
      withFakeBrowserGlobals(
        { getToken: async () => { getTokenCalls += 1; return "fresh-token"; } },
        () =>
          withFakeFetch(async () => {
            fetchCalls += 1;
            return fakeResponse({ status: 401, ok: false, body: null });
          }, () => fetchMarketIndices())
      ),
    /→ 401/
  );
  assert.equal(fetchCalls, 2, "exactly one retry attempt — never an infinite 401 loop");
  assert.equal(getTokenCalls, 1, "refresh is attempted only once per call, not once per attempt");
});

test("marketFetch: no window.Clerk session (SSR / fully signed out) throws immediately on 401", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      withFakeBrowserGlobals({ noClerk: true }, () =>
        withFakeFetch(async () => {
          fetchCalls += 1;
          return fakeResponse({ status: 401, ok: false, body: null });
        }, () => fetchMarketIndices())
      ),
    /→ 401/
  );
  assert.equal(fetchCalls, 1, "must not retry when there is no session to refresh");
});

test("marketFetch: the existing 403 tier-gate retry-with-backoff is unchanged", async () => {
  let fetchCalls = 0;
  const result = await withFakeBrowserGlobals({ noClerk: true }, () =>
    withFakeFetch(async () => {
      fetchCalls += 1;
      if (fetchCalls < 3) return fakeResponse({ status: 403, ok: false, body: null });
      return fakeResponse({ status: 200, ok: true, body: { spx: null, vix: null, source: "test", as_of: "now" } });
    }, () => fetchMarketIndices())
  );
  assert.equal(fetchCalls, 3, "the 401 refresh path must not consume or interfere with the 403 retry budget");
  assert.ok(result);
});

test("intelFetch: a 401 triggers one silent Clerk refresh and a successful retry", async () => {
  let fetchCalls = 0;
  let getTokenCalls = 0;
  const result = await withFakeBrowserGlobals(
    { getToken: async () => { getTokenCalls += 1; return "fresh-token"; } },
    () =>
      withFakeFetch(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return fakeResponse({ status: 401, ok: false, body: null });
        return fakeResponse({ status: 200, ok: true, body: { plays: [] } });
      }, () => fetchNightHawkPlays())
  );
  assert.equal(fetchCalls, 2, "must retry exactly once after a successful refresh");
  assert.equal(getTokenCalls, 1);
  assert.deepEqual(result, { plays: [] });
});

test("intelFetch: a failed refresh attempt (getToken throws) throws the original 401 without retrying", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      withFakeBrowserGlobals(
        { getToken: async () => { throw new Error("network error minting token"); } },
        () =>
          withFakeFetch(async () => {
            fetchCalls += 1;
            return fakeResponse({ status: 401, ok: false, body: null });
          }, () => fetchNightHawkPlays())
      ),
    /→ 401/
  );
  assert.equal(fetchCalls, 1, "a refresh that throws must not be retried — fall through to the original error");
});
