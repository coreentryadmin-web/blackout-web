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
import { readSessionAdminFlag, writeSessionAdminFlag } from "./use-admin-flag";

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
