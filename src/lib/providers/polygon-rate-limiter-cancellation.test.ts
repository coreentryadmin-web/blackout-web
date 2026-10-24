import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { __allowFetchHostForTest } from "../api-tracked-fetch";

// Proves polygonTrackedFetch's caller-supplied signal terminates the REAL underlying
// connection, not just the caller's own wait — the same class of proof
// fetch-timeout.test.ts already gives for the UW/dossier side (PR #5111).
//
// Disclosure: this specific test does NOT distinguish pre-fix from post-fix code (verified
// by stashing the polygon-rate-limiter.ts fix and re-running — it still passes), because
// trackedFetch's own signal-to-fetch() wiring already worked before this change; only the
// ADMISSION-stage abort-awareness (acquirePolygonSlot never checking `signal` at all,
// waiting the full queue budget regardless) was actually broken pre-fix, and that specific
// regression is what polygon-rate-limiter-abort-latency.test.ts proves RED-then-GREEN
// (confirmed by the same stash-and-rerun method: both its tests fail pre-fix, one via a
// 20s RateLimiterQueueTimeoutError instead of a ~15ms abort). This test's own value is
// proving the on-the-wire outcome end to end on an uncontended admission path, not the
// admission-stage fix in isolation.
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

/** Tracks the raw TCP connection, not the parsed HTTP request — see fetch-timeout.test.ts's
 *  identical helper for why this is more accurate than a fixed sleep before aborting. */
function hangingServerWithConnectionTracking(): {
  server: Server;
  waitForConnection: (timeoutMs: number) => Promise<boolean>;
  waitForClose: (timeoutMs: number) => Promise<boolean>;
} {
  let socket: Socket | null = null;
  let closed = false;
  let onClose: (() => void) | null = null;
  const server = createServer(() => {
    // Never call res.end() — a stalled upstream, exactly like the live incidents this fix targets.
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

test("polygonTrackedFetch: aborting the caller's signal terminates the real underlying connection, through the abort-aware admission stage to the real fetch()", async () => {
  const { polygonTrackedFetch } = await import("./polygon-rate-limiter");
  const { server, waitForConnection, waitForClose } = hangingServerWithConnectionTracking();
  const base = await listen(server);
  try {
    const controller = new AbortController();
    const pending = polygonTrackedFetch("/test", `${base}/hang`, { signal: controller.signal });
    pending.catch(() => {});

    assert.ok(await waitForConnection(2000), "the request must actually reach the server for this test to prove anything");
    controller.abort();

    await assert.rejects(pending);

    const closedInTime = await waitForClose(1000);
    assert.equal(
      closedInTime,
      true,
      "aborting polygonTrackedFetch's caller-supplied signal must terminate the REAL connection, " +
        "not just stop the caller from waiting on it"
    );
  } finally {
    server.close();
  }
});
