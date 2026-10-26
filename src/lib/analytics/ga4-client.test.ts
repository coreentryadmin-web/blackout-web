import test from "node:test";
import assert from "node:assert/strict";

/**
 * Regression coverage for the signup-conversion-lost-before-gtag-ready bug: `Ga4Attribution`
 * used to gate its `/upgrade` signup fire on `consumePendingSignUp()` directly, which clears the
 * pending-signup flag as a SIDE EFFECT of the gate check itself — even when gtag's
 * `strategy="afterInteractive"` script hadn't finished loading yet, so the actual `gtag(...)`
 * calls (GA4 event + Google Ads conversion) silently no-op'd. The flag was already destroyed by
 * then, so the conversion was lost permanently with no way to retry.
 *
 * `hasPendingSignUp()` is the non-destructive half of the fix: callers must peek with this BEFORE
 * deciding whether they can actually dispatch, and only call the destructive `consumePendingSignUp`
 * once they know the dispatch will succeed. These tests pin that `hasPendingSignUp` never clears
 * the flag, so a dropped fire (gtag not ready) leaves it in place for the next page load to retry.
 */

function withFakeSessionStorage<T>(run: () => T): T {
  const store = new Map<string, string>();
  const fakeSessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const originalWindow = globalThis.window;
  const originalSessionStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: fakeSessionStorage,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
  }
}

test("hasPendingSignUp reports true after markPendingSignUp without clearing it", async () => {
  const { markPendingSignUp, hasPendingSignUp } = await import("./ga4-client.ts");
  withFakeSessionStorage(() => {
    assert.equal(hasPendingSignUp(), false);
    markPendingSignUp();
    assert.equal(hasPendingSignUp(), true);
    // Peeking again must NOT consume it — this is the whole point of the fix: a caller that
    // isn't ready to dispatch yet (gtag not loaded) can check and recheck without losing the flag.
    assert.equal(hasPendingSignUp(), true);
    assert.equal(hasPendingSignUp(), true);
  });
});

test("consumePendingSignUp still clears the flag (the destructive half, called only once dispatch is certain)", async () => {
  const { markPendingSignUp, hasPendingSignUp, consumePendingSignUp } = await import(
    "./ga4-client.ts"
  );
  withFakeSessionStorage(() => {
    markPendingSignUp();
    assert.equal(hasPendingSignUp(), true);
    assert.equal(consumePendingSignUp(), true);
    assert.equal(hasPendingSignUp(), false);
    assert.equal(consumePendingSignUp(), false);
  });
});

test("hasPendingSignUp is false off the browser (SSR) and never throws", async () => {
  const { hasPendingSignUp } = await import("./ga4-client.ts");
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  try {
    assert.equal(hasPendingSignUp(), false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
