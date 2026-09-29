import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { dossierFetch } from "./fetch-timeout";
import { trackedFetch, __allowFetchHostForTest } from "../../../lib/api-tracked-fetch";

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

/**
 * Tracks the raw TCP connection rather than the parsed HTTP request. Deliberate: an abort
 * that fires while the connection is still being established (or before Node has finished
 * parsing the request headers) never invokes the http.Server's `request` handler at all, so
 * a `req.on('close', ...)` attached only inside that handler can silently never attach —
 * which would misreport a real, fast cancellation as "the connection never closed". The
 * `connection` event fires the instant the TCP socket is accepted, before any HTTP parsing,
 * so this is accurate regardless of how early the abort lands relative to that parsing.
 */
function hangingServerWithConnectionTracking(): {
  server: Server;
  waitForConnection: (timeoutMs: number) => Promise<boolean>;
  waitForClose: (timeoutMs: number) => Promise<boolean>;
} {
  let socket: Socket | null = null;
  let closed = false;
  let onClose: (() => void) | null = null;
  const server = createServer(() => {
    // Never call res.end() — simulates the real stalled-upstream shape this whole fix targets.
  });
  server.on("connection", (sock) => {
    socket = sock;
    sock.on("close", () => {
      closed = true;
      onClose?.();
    });
  });
  return {
    server,
    waitForConnection: (timeoutMs) =>
      new Promise<boolean>((resolve) => {
        if (socket) return resolve(true);
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          if (socket) return resolve(true);
          if (Date.now() >= deadline) return resolve(false);
          setTimeout(tick, 2);
        };
        tick();
      }),
    waitForClose: (timeoutMs) =>
      new Promise<boolean>((resolve) => {
        if (closed) return resolve(true);
        const timer = setTimeout(() => resolve(false), timeoutMs);
        onClose = () => {
          clearTimeout(timer);
          resolve(true);
        };
      }),
  };
}

/**
 * THE CENTERPIECE PROOF (Phase 2, 2026-09-17): dossierFetch's own local-timeout controller
 * has always correctly aborted `controller.signal` — the bug this whole fix targets was
 * every real call site in dossier.ts discarding that signal (`() => someFetch(...)`) instead
 * of threading it into the actual fetch (`(signal) => someFetch(..., signal)`), so the
 * ABANDONED underlying connection kept running in the background, still holding a slot on
 * the shared UW rate limiter, after Legacy had already moved on to the next ticker.
 *
 * This test reproduces BOTH shapes against the SAME dossierFetch implementation, proving the
 * causality directly rather than asserting it from a diff: the "current"/RED case uses the
 * exact discarding-closure pattern every dossier.ts call site used to use; the "patched"/GREEN
 * case uses the exact signal-threading pattern every call site now uses. Same server, same
 * timeout, same dossierFetch — the only variable is whether the caller's closure honors the
 * signal argument.
 */
test("RED: a caller that discards dossierFetch's signal (the pre-fix dossier.ts call-site pattern) leaves the real connection alive after dossierFetch itself has already given up", async () => {
  const { server, waitForConnection, waitForClose } = hangingServerWithConnectionTracking();
  const base = await listen(server);
  try {
    const start = Date.now();
    // The exact buggy shape: `() => trackedFetch(...)` — signal argument never referenced.
    // trackedFetch's own timeoutMs is kept short (600ms, well past the 300ms "still alive"
    // check below) purely so this test's own dangling zombie connection — the exact bug being
    // proven — doesn't hold this file's process open for a full 5s once every assertion below
    // has already passed; it plays no role in what's being demonstrated.
    const resultPromise = dossierFetch(
      () => trackedFetch("unusual_whales", "/test", `${base}/hang`, { timeoutMs: 600 }),
      "fallback",
      30
    );
    assert.ok(await waitForConnection(2000), "the request must actually reach the server for this test to prove anything");

    const result = await resultPromise;
    assert.equal(result, "fallback", "dossierFetch's own 30ms wall must still fire and return the fallback");
    assert.ok(Date.now() - start < 2000, "dossierFetch must not itself block waiting for the abandoned connection");

    // The real bug: the underlying connection is NOT terminated just because the caller gave
    // up waiting on it. Give it a real window well past dossierFetch's own 30ms wall to prove
    // this isn't a timing coincidence — the server genuinely never sees a close.
    const closedInTime = await waitForClose(300);
    assert.equal(
      closedInTime,
      false,
      "REGRESSION: the pre-fix call-site pattern must leave the connection alive — if this now " +
        "fails, dossierFetch's fallback-fetch layer changed to auto-abort discarded signals, and " +
        "this test (and its accompanying doc comment) needs to be revisited, not silenced"
    );
  } finally {
    server.close();
  }
});

test("GREEN: a caller that threads dossierFetch's signal into the real fetch (the current dossier.ts call-site pattern) causes the server to observe the connection actually close", async () => {
  const { server, waitForConnection, waitForClose } = hangingServerWithConnectionTracking();
  const base = await listen(server);
  try {
    const start = Date.now();
    // The fixed shape: `(signal) => trackedFetch(..., { signal })` — every real dossier.ts UW
    // call site now looks like this (unusual-whales.ts threads it the rest of the way to fetch()).
    const resultPromise = dossierFetch(
      (signal) => trackedFetch("unusual_whales", "/test", `${base}/hang`, { timeoutMs: 5000, signal }),
      "fallback",
      30
    );
    assert.ok(await waitForConnection(2000), "the request must actually reach the server for this test to prove anything");

    const result = await resultPromise;
    assert.equal(result, "fallback", "dossierFetch's own 30ms wall must still fire and return the fallback");
    assert.ok(Date.now() - start < 2000, "dossierFetch must not itself block waiting for the connection to close");

    // The fix: the server actually observes the connection close, well within a window far
    // short of trackedFetch's own 5000ms timeout — proving the abort is real, not "eventually
    // the unrelated 5s timeout would have cleaned it up anyway".
    const closedInTime = await waitForClose(1000);
    assert.equal(
      closedInTime,
      true,
      "the real network connection must be terminated once dossierFetch's wall fires and the " +
        "signal is threaded through to the actual fetch() call"
    );
  } finally {
    server.close();
  }
});

test("dossierFetch also aborts fn's real connection when the OUTER signal (the per-ticker 45s wall) fires, not only its own local timeout", async () => {
  const { server, waitForConnection, waitForClose } = hangingServerWithConnectionTracking();
  const base = await listen(server);
  const outer = new AbortController();
  try {
    const pending = dossierFetch(
      (signal) => trackedFetch("unusual_whales", "/test", `${base}/hang`, { timeoutMs: 5000, signal }),
      "fallback",
      5000, // local wall deliberately long — the OUTER signal must be what fires here
      outer.signal
    );
    assert.ok(await waitForConnection(2000), "the request must actually reach the server before we abort it");
    outer.abort();

    const result = await pending;
    assert.equal(result, "fallback");

    const closedInTime = await waitForClose(1000);
    assert.equal(
      closedInTime,
      true,
      "an outer-signal abort (e.g. dossier.ts's per-ticker wall) must terminate the real " +
        "connection exactly like dossierFetch's own local timeout does"
    );
  } finally {
    server.close();
  }
});
