import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

function withFakeDocumentCookie<T>(cookie: string, run: () => T): T {
  const g = globalThis as typeof globalThis & { document?: { cookie: string }; window?: unknown };
  const originalDocument = g.document;
  const originalWindow = g.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  g.document = { cookie };
  try {
    return run();
  } finally {
    if (originalDocument === undefined) delete g.document;
    else g.document = originalDocument;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
}

/**
 * Regression coverage (round 194): `hasSessionCookie` used to check
 * `document.cookie.includes("__session=")`, a bare-name-only substring match that misses Clerk's
 * suffixed `__session_<publishableKeySuffix>` cookie — the same real, already-confirmed-live
 * cookie shape #797/#7082 fixed server-side (`req.cookies`), but this client-side
 * (`document.cookie`) check was never updated to match. A signed-in member carrying only the
 * suffixed cookie silently never fired the `/upgrade` GA4 `sign_up` event, the Google Ads
 * `signup` conversion, or the desk `desk_opened` event — all three are gated on this function in
 * `Ga4Attribution.tsx`.
 */
test("hasSessionCookie detects a SUFFIXED-only __session cookie (real #797/#7082 scenario)", async () => {
  const { hasSessionCookie } = await import("./ga4-client.ts");
  withFakeDocumentCookie("__session_AbCdEf12=eyJ.fake.jwt", () => {
    assert.equal(hasSessionCookie(), true);
  });
});

test("hasSessionCookie still detects the bare __session cookie", async () => {
  const { hasSessionCookie } = await import("./ga4-client.ts");
  withFakeDocumentCookie("__session=eyJ.fake.jwt", () => {
    assert.equal(hasSessionCookie(), true);
  });
});

test("hasSessionCookie is false when no session cookie is present", async () => {
  const { hasSessionCookie } = await import("./ga4-client.ts");
  withFakeDocumentCookie("unrelated=1", () => {
    assert.equal(hasSessionCookie(), false);
  });
});

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

function withFakeLocalStorage<T>(run: () => T): T {
  const store = new Map<string, string>();
  const fakeLocalStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const originalWindow = globalThis.window;
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: fakeLocalStorage,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
}

test("hasPurchaseFired is false until markPurchaseFired, and the check itself never writes", async () => {
  const { hasPurchaseFired, markPurchaseFired } = await import("./ga4-client.ts");
  withFakeLocalStorage(() => {
    assert.equal(hasPurchaseFired("user_1"), false);
    // Peeking repeatedly before marking must never persist anything — this is the whole point of
    // the fix: a caller that isn't ready to dispatch yet (gtag not loaded) can check and recheck
    // across separate mounts (e.g. a page refresh) without the flag ever being set behind it.
    assert.equal(hasPurchaseFired("user_1"), false);
    markPurchaseFired("user_1");
    assert.equal(hasPurchaseFired("user_1"), true);
  });
});

test("hasPurchaseFired is scoped per user — one user's flag never shadows another's", async () => {
  const { hasPurchaseFired, markPurchaseFired } = await import("./ga4-client.ts");
  withFakeLocalStorage(() => {
    markPurchaseFired("user_1");
    assert.equal(hasPurchaseFired("user_1"), true);
    assert.equal(hasPurchaseFired("user_2"), false);
  });
});

test("hasPurchaseFired is false off the browser (SSR) and never throws", async () => {
  const { hasPurchaseFired } = await import("./ga4-client.ts");
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  try {
    assert.equal(hasPurchaseFired("user_1"), false);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

/**
 * Regression coverage for a duplicated-literal drift risk (found 2026-10-31, round 146 dead-code
 * sweep): `utm.ts` exports `GA4_PENDING_SIGNUP_KEY = "bo_ga4_pending_signup_v1"` as the named
 * source of truth for this sessionStorage key, but `markPendingSignUp`/`hasPendingSignUp`/
 * `consumePendingSignUp` in this file used to spell the SAME string out as three independent
 * literals instead of importing the constant. The three copies happened to agree today, but
 * nothing enforced that — editing the exported constant (the obviously "correct" place to change
 * this key) would silently leave the three literals here stale, breaking the pending-signup
 * dedupe flow with no compiler or test error. Fixed by importing `GA4_PENDING_SIGNUP_KEY` and
 * using it at all three call sites. This test pins the fix at the SOURCE level (not just
 * behavior, which is identical either way since the values already matched) by asserting the
 * literal string value never reappears hardcoded in this file.
 */
test("the pending-signup storage key is never hardcoded as a duplicate literal in this file", () => {
  const thisFile = fileURLToPath(import.meta.url).replace(/\.test\.ts$/, ".ts");
  const source = readFileSync(thisFile, "utf8");
  assert.ok(
    source.includes("GA4_PENDING_SIGNUP_KEY"),
    "ga4-client.ts must import and reference the shared GA4_PENDING_SIGNUP_KEY constant",
  );
  assert.ok(
    !source.includes('"bo_ga4_pending_signup_v1"') && !source.includes("'bo_ga4_pending_signup_v1'"),
    "the pending-signup key must come from the imported GA4_PENDING_SIGNUP_KEY constant, " +
      "never a hardcoded duplicate literal that could silently drift from it",
  );
});
