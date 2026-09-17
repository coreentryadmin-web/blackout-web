import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { trackedFetch, __allowFetchHostForTest } from "./api-tracked-fetch";

// The host-allowlist guard (SSRF hardening) rejects any destination outside this app's
// known providers by default — these tests need their own local ephemeral server allowed.
__allowFetchHostForTest("127.0.0.1");

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// Regression test for the live GEX-heatmap/gex-positioning production incident: a stalled
// upstream Polygon connection hung the calling request indefinitely because bare fetch() has
// no timeout and no caller passed a `signal`. This server never responds, simulating that hang.
test("trackedFetch aborts a stalled request instead of hanging forever", async () => {
  const server = createServer(() => {
    // Never call res.end() — the connection just hangs, like the live api.massive.com incident.
  });
  const base = await listen(server);
  try {
    const start = Date.now();
    await assert.rejects(
      () => trackedFetch("polygon", "/test", `${base}/hang`, { timeoutMs: 50 }),
      /timeout/i
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `expected a fast abort, took ${elapsed}ms`);
  } finally {
    server.close();
  }
});

test("trackedFetch still returns a fast, healthy response normally", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const base = await listen(server);
  try {
    const res = await trackedFetch("polygon", "/test", `${base}/ok`, { timeoutMs: 5000 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

test("trackedFetch honors a caller-supplied signal alongside the default timeout", async () => {
  const server = createServer(() => {
    // Hangs — the caller's own controller should win here since it fires first.
  });
  const base = await listen(server);
  const controller = new AbortController();
  try {
    const pending = trackedFetch("polygon", "/test", `${base}/hang`, {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(() => pending);
  } finally {
    server.close();
  }
});

// Regression: with maxRetries set (as every real caller that passes a signal through
// polygonTrackedFetch/uwTrackedFetch does — maxRetries: 1), the retry loop used to retry on
// ANY caught error, caller-initiated AbortError included. That fired a SECOND real fetch()
// whose composed signal (AbortSignal.any of the caller's already-aborted signal + a fresh
// per-attempt timeout) was already aborted before the call even started -- which doesn't fail
// fast, it opens a second real connection that dangles for a full per-attempt timeout. Net
// effect: an aborted call with maxRetries:1 took roughly 2x the per-attempt timeout to settle
// instead of resolving promptly, defeating the entire point of passing a signal. This is the
// root cause behind the ~30s hangs measured in polygon-short-interest-cancellation.test.ts and
// polygon-largo-cancellation.test.ts's RED runs before their own leaf-level signal threading
// fixes, and it silently undermines every one of those fixes even once signal threading is
// correct, because the retry itself reopens the exact connection the caller just cancelled.
test("trackedFetch never retries after the caller's own signal aborts, even with maxRetries set", async () => {
  // Counting raw TCP connections at the server does NOT distinguish this fix: Node's own fetch
  // implementation (undici) independently replaces a keep-alive pool socket that was destroyed
  // mid-request, opening its OWN second physical connection a few ms after the abort regardless
  // of anything trackedFetch does (verified directly against a bare, unwrapped fetch() call with
  // no retry logic at all -- it also opens exactly 2 raw connections on an aborted request, the
  // second closing ~4s later on undici's own default keepAliveTimeout). That is undici's internal
  // business, not a bug this fix is about. The actual claim under test -- does trackedFetch's OWN
  // retry loop call fetch() a second time -- is proven by spying on the fetch() CALL COUNT
  // instead: pre-fix this was 2 (the loop's own retry), post-fix it's 1.
  const server = createServer(() => {
    // Never respond — every attempt (original or would-be retry) hangs until timeout/abort.
  });
  const base = await listen(server);
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCallCount += 1;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    const start = Date.now();
    const pending = trackedFetch("polygon", "/test", `${base}/hang`, {
      timeoutMs: 15_000,
      maxRetries: 1,
      retryDelayMs: 50,
      signal: controller.signal,
    });
    // Give the first attempt a moment to actually reach the server before aborting, so this
    // test proves a genuine in-flight cancellation, not a same-tick no-op.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fetchCallCount, 1, "the first attempt must actually have called fetch() for this test to prove anything");
    controller.abort();
    await assert.rejects(() => pending);
    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 2000,
      `an aborted call with maxRetries set must settle promptly, not wait out a retried attempt's timeout; took ${elapsed}ms`
    );
    // Give any wrongly-fired retry a chance to call fetch() again before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      fetchCallCount,
      1,
      "must never call fetch() again after the caller's own signal aborted the first attempt"
    );
  } finally {
    globalThis.fetch = originalFetch;
    server.close();
  }
});

// SSRF hardening (request-forgery, FINDINGS.md): trackedFetch is the single network-egress
// choke point for every provider this app calls. Per-fragment ticker/path sanitizers at each
// call site (safeTicker, resolveOptionsRoot, etc.) close injection there, but a future
// unsanitized caller could still slip through — this is the backstop that closes the whole
// bug class at the one place every flow must pass through, regardless of how its URL was
// built upstream.
test("trackedFetch refuses to fetch a host outside the known-provider allowlist, without ever attempting the network call", async () => {
  await assert.rejects(
    () => trackedFetch("polygon", "/test", "https://evil.example.com/exfiltrate"),
    /disallowed host/i
  );
});

test("trackedFetch refuses a disallowed host even when it's just a differently-cased/subdomain lookalike of a real provider", async () => {
  await assert.rejects(
    () => trackedFetch("unusual_whales", "/test", "https://api.unusualwhales.com.evil.com/x"),
    /disallowed host/i
  );
});

test("SECURITY: the disallowed-host throw never carries a live API key", async () => {
  // THE LEAK (observed twice, 2026-08-17). An unresolved base placeholder produces a URL with no
  // parseable hostname, so the guard's fallback printed the RAW url — including `apiKey=<real key>`
  // — into the thrown message and from there into CI logs. The sanitized url must be used instead.
  const leaky =
    "POLYGON_API_BASE/benzinga/v1/earnings?limit=200&apiKey=SUPERSECRETKEYVALUE123&token=alsosecret";
  let msg = "";
  try {
    await trackedFetch("polygon", "/test", leaky);
  } catch (e) {
    msg = String((e as Error).message);
  }
  assert.ok(msg.includes("refusing to fetch disallowed host"), `unexpected error: ${msg}`);
  assert.ok(!msg.includes("SUPERSECRETKEYVALUE123"), "the API key must never reach the message");
  assert.ok(!msg.includes("alsosecret"), "nor any other credential query param");
  assert.ok(msg.includes("[REDACTED]"), "the value is redacted, not silently dropped");
});
