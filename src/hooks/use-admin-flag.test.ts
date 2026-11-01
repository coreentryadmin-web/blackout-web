/**
 * Regression guard: `readSessionAdminFlag`/`writeSessionAdminFlag` (use-admin-flag.ts) are the one
 * `sessionStorage`/`localStorage` call site in this repo that did NOT wrap storage access in
 * try/catch — every sibling (vector-alerts-store.ts, vector-drawings-store.ts, thermal-saved-desks.ts,
 * meridian-desk-prefs.ts, chunk-load-error.ts) degrades to a safe default when storage access throws
 * (SecurityError in a sandboxed embed, "Block All Cookies", private-mode quota). This hook backs the
 * shared admin flag for Nav + iOS chrome, so an uncaught throw here would have broken global nav for
 * any member whose browser blocks storage access.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { adminMeSwrKey, readSessionAdminFlag, writeSessionAdminFlag } from "./use-admin-flag";

function withThrowingSessionStorage<T>(run: () => T): T {
  const original = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: () => {
        throw new Error("SecurityError: storage access blocked");
      },
      setItem: () => {
        throw new Error("SecurityError: storage access blocked");
      },
    },
    configurable: true,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", { value: original, configurable: true });
  }
}

test("readSessionAdminFlag: never throws when sessionStorage.getItem throws — returns null", () => {
  const result = withThrowingSessionStorage(() => readSessionAdminFlag("user_123"));
  assert.equal(result, null);
});

test("writeSessionAdminFlag: never throws when sessionStorage.setItem throws", () => {
  assert.doesNotThrow(() => withThrowingSessionStorage(() => writeSessionAdminFlag("user_123", true)));
});

test("readSessionAdminFlag: null userId short-circuits without touching storage", () => {
  assert.equal(readSessionAdminFlag(null), null);
  assert.equal(readSessionAdminFlag(undefined), null);
});

test("readSessionAdminFlag/writeSessionAdminFlag: round-trip through a working store", () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    configurable: true,
  });
  try {
    assert.equal(readSessionAdminFlag("user_456"), null, "unset key reads as null (unknown)");
    writeSessionAdminFlag("user_456", true);
    assert.equal(readSessionAdminFlag("user_456"), true);
    writeSessionAdminFlag("user_456", false);
    assert.equal(readSessionAdminFlag("user_456"), false);
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", { value: undefined, configurable: true });
  }
});

function withGetterThrowingSessionStorage<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
}

test("readSessionAdminFlag: a getter-level sessionStorage throw degrades to null, not an uncaught throw", () => {
  const result = withGetterThrowingSessionStorage(() => readSessionAdminFlag("user_789"));
  assert.equal(result, null);
});

test("writeSessionAdminFlag: a getter-level sessionStorage throw is swallowed, not an uncaught throw", () => {
  assert.doesNotThrow(() => withGetterThrowingSessionStorage(() => writeSessionAdminFlag("user_789", true)));
});

test("adminMeSwrKey: two different signed-in users get different SWR cache keys", () => {
  const keyA = adminMeSwrKey(true, true, "user_A");
  const keyB = adminMeSwrKey(true, true, "user_B");
  assert.notEqual(JSON.stringify(keyA), JSON.stringify(keyB));
});

test("adminMeSwrKey: the SAME user re-rendering gets the SAME key (dedupingInterval still applies)", () => {
  const first = adminMeSwrKey(true, true, "user_A");
  const second = adminMeSwrKey(true, true, "user_A");
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("adminMeSwrKey: null while signed out, or not yet loaded — never fetches/serves stale data", () => {
  assert.equal(adminMeSwrKey(true, false, "user_A"), null);
  assert.equal(adminMeSwrKey(false, true, "user_A"), null);
  assert.equal(adminMeSwrKey(true, true, null), null);
  assert.equal(adminMeSwrKey(true, true, undefined), null);
});
