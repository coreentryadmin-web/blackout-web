import test from "node:test";
import assert from "node:assert/strict";
import { reportAuthFailure } from "./AuthFailureObserver.tsx";

/**
 * Regression guard: reportAuthFailure's sendBeacon-unavailable fallback did
 * `void fetch(...)` with no `.catch()`. The surrounding try/catch only
 * catches synchronous throws, not a promise rejection raised after fetch()
 * has already returned — so a rejected fetch (network error, ad-blocker,
 * etc.) became an unhandled promise rejection, the same shape already
 * guarded against in the two sibling fire-and-forget telemetry callers
 * (ClientErrorReporter.tsx, AuthSignedInRedirect.tsx), both of which chain
 * `.catch(() => undefined)` on their fetch fallback.
 */

function withFakeNavigatorNoBeacon<T>(run: () => T): T {
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: original });
  }
}

function withRejectingFetch<T>(run: () => T): T {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    return run();
  } finally {
    globalThis.fetch = original;
  }
}

test("reportAuthFailure: a rejected fetch fallback never surfaces as an unhandled rejection", async () => {
  let unhandled: unknown = null;
  const onUnhandled = (reason: unknown) => {
    unhandled = reason;
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    withFakeNavigatorNoBeacon(() => {
      withRejectingFetch(() => {
        reportAuthFailure("Invalid password", "signin");
      });
    });

    // Let the microtask queue (the rejected fetch promise) drain before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  assert.equal(unhandled, null, "a rejected fetch fallback must be caught, not leak as an unhandled rejection");
});
