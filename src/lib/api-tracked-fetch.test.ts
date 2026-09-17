import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { trackedFetch, __allowFetchHostForTest } from "./api-tracked-fetch";
import { getEventsSinceSeq, getLatestSeqId } from "./api-telemetry";

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

// Phase 1 instrumentation (queue-wait vs. HTTP-execution split). Every test above this
// point calls trackedFetch with NO queueWaitMs/cancelReason — proving those calls still
// pass (unchanged assertions, unchanged behavior) is the "before === after" evidence for
// this instrumentation-only change. These two tests cover the new, additive behavior itself.

test("trackedFetch: omitting queueWaitMs emits no [api-queue-timing] line and records queue_wait_ms=null (default/legacy-caller path)", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const base = await listen(server);
  const originalInfo = console.info;
  const infoLines: string[] = [];
  console.info = (...args: unknown[]) => {
    infoLines.push(String(args[0]));
  };
  try {
    const sinceSeq = getLatestSeqId();
    await trackedFetch("polygon", "/test", `${base}/ok`, { timeoutMs: 5000 });
    const recorded = getEventsSinceSeq(sinceSeq);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.queue_wait_ms, null);
    assert.equal(recorded[0]!.cancel_reason, null);
    assert.ok(
      !infoLines.some((l) => l.includes("[api-queue-timing]")),
      "a caller with no queue-timing context must not emit the new log line at all"
    );
  } finally {
    console.info = originalInfo;
    server.close();
  }
});

test("trackedFetch: a caller-supplied queueWaitMs is recorded on the event AND logged, joined by correlationId", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const base = await listen(server);
  const originalInfo = console.info;
  const infoLines: string[] = [];
  console.info = (...args: unknown[]) => {
    infoLines.push(String(args[0]));
  };
  try {
    const sinceSeq = getLatestSeqId();
    await trackedFetch("unusual_whales", "/api/darkpool/AAPL", `${base}/ok`, {
      timeoutMs: 5000,
      correlationId: "test-corr-123",
      queueWaitMs: 4321,
    });
    const recorded = getEventsSinceSeq(sinceSeq);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.queue_wait_ms, 4321);
    assert.equal(recorded[0]!.correlation_id, "test-corr-123");
    const line = infoLines.find((l) => l.includes("[api-queue-timing]"));
    assert.ok(line, "expected a queue-timing log line when queueWaitMs is supplied");
    assert.ok(line!.includes("correlation_id=test-corr-123"));
    assert.ok(line!.includes("queue_wait_ms=4321"));
    assert.ok(line!.includes("cancel_reason=-"), "a successful call has no cancel reason");
  } finally {
    console.info = originalInfo;
    server.close();
  }
});

// CodeQL log-injection guard (#990, found via PR #5111's own scan): logQueueTiming's
// [api-queue-timing] line interpolates several caller-influenced string fields
// (endpoint/correlationId/cancelReason) with no length/type guarantee enforced at that
// function's own boundary. A value containing CR/LF could forge a fake extra log line or
// inject bogus fields into CloudWatch. None of today's real callers can actually reach this
// (endpoint segments already pass safeTicker/safePathSegment, no caller sets cancelReason
// yet), but the guard belongs at the log call site itself, not at every future caller.
test("trackedFetch: a newline-bearing endpoint/correlationId cannot forge extra log lines or fields", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  const base = await listen(server);
  const originalInfo = console.info;
  const infoLines: string[] = [];
  console.info = (...args: unknown[]) => {
    infoLines.push(String(args[0]));
  };
  try {
    await trackedFetch("unusual_whales", "/api/darkpool/AAPL\nfake_field=injected", `${base}/ok`, {
      timeoutMs: 5000,
      correlationId: "corr-1\n[api-queue-timing] forged_line=true",
      queueWaitMs: 100,
    });
    const line = infoLines.find((l) => l.includes("[api-queue-timing]"));
    assert.ok(line, "expected a queue-timing log line");
    assert.ok(!line!.includes("\n"), "the logged line must never contain a raw newline");
    assert.ok(
      line!.includes("endpoint=/api/darkpool/AAPL fake_field=injected"),
      `expected the newline replaced with a space, got: ${line}`
    );
    assert.ok(
      line!.includes("correlation_id=corr-1 [api-queue-timing] forged_line=true"),
      `expected the newline replaced with a space, got: ${line}`
    );
    // Exactly one real [api-queue-timing] entry was emitted — the payload never became a
    // second, attacker-authored log line of its own.
    assert.equal(
      infoLines.filter((l) => l.includes("[api-queue-timing]")).length,
      1,
      "the malicious payload must not have produced a second log call"
    );
  } finally {
    console.info = originalInfo;
    server.close();
  }
});

test("trackedFetch: a newline-bearing caller-supplied cancelReason cannot forge extra log lines or fields", async () => {
  const server = createServer(() => {
    // Never responds — trackedFetch's own internal timeout fires, taking the abort path
    // that's the only place a caller-supplied cancelReason is actually read.
  });
  const base = await listen(server);
  const originalInfo = console.info;
  const infoLines: string[] = [];
  console.info = (...args: unknown[]) => {
    infoLines.push(String(args[0]));
  };
  try {
    await assert.rejects(() =>
      trackedFetch("polygon", "/test", `${base}/hang`, {
        timeoutMs: 30,
        queueWaitMs: 50,
        cancelReason: "ticker_wall_timeout\n[api-queue-timing] forged_line=true",
      })
    );
    const line = infoLines.find((l) => l.includes("[api-queue-timing]"));
    assert.ok(line, "expected a queue-timing log line");
    assert.ok(!line!.includes("\n"), "the logged line must never contain a raw newline");
    assert.ok(
      line!.includes("cancel_reason=ticker_wall_timeout [api-queue-timing] forged_line=true"),
      `expected the newline replaced with a space, got: ${line}`
    );
    assert.equal(
      infoLines.filter((l) => l.includes("[api-queue-timing]")).length,
      1,
      "the malicious payload must not have produced a second log call"
    );
  } finally {
    console.info = originalInfo;
    server.close();
  }
});

test("trackedFetch: an AbortError with no caller-supplied cancelReason records the generic default_fetch_timeout reason (today's only real abort path, now labeled)", async () => {
  const server = createServer(() => {
    // Never responds — trackedFetch's own internal timeout fires.
  });
  const base = await listen(server);
  try {
    const sinceSeq = getLatestSeqId();
    await assert.rejects(() => trackedFetch("polygon", "/test", `${base}/hang`, { timeoutMs: 30 }));
    const recorded = getEventsSinceSeq(sinceSeq);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.cancel_reason, "default_fetch_timeout");
  } finally {
    server.close();
  }
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
