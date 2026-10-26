/**
 * Regression guard: `readLocal`/`writeLocal` (JournalEditor.tsx) called `window.localStorage`
 * directly with no try/catch. `readLocal` runs inside a `useMemo` at render time (seeding the
 * editor from a locally-cached note when no server-side entry exists), so a thrown `SecurityError`
 * — private browsing, a sandboxed admin-tool iframe, blocked storage, quota — crashed the whole
 * component render rather than just losing the local-only cache. `writeLocal` is called from
 * `save()` BEFORE its own try/catch begins, so the same throw there defeated the optimistic
 * local-save comment's own promise ("so a note survives even if the API call fails") and left
 * `status` stuck at "saving" forever, since the throw happened before `setStatus("saved"/"error")`
 * could ever run. Every sibling storage call site in this repo (ga4-client.ts, chunk-load-error.ts,
 * use-admin-flag.ts) already degrades to a safe default on a thrown storage access; this file was
 * the one for trade-journal notes that didn't.
 */
import assert from "node:assert/strict";
import test from "node:test";

function withFakeLocalStorage<T>(
  fakeLocalStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  run: () => T
): T {
  // JournalEditor.tsx reads `window.localStorage` (not the bare global `localStorage`), so the
  // fake must live ON the fake `window`, not as a separate top-level global.
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: fakeLocalStorage },
  });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
}

function throwingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const throwIt = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: throwIt, setItem: throwIt, removeItem: throwIt };
}

function workingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

test("readLocal: blocked storage degrades to an empty map instead of throwing", async () => {
  const { readLocal } = await import("./JournalEditor.tsx");
  withFakeLocalStorage(throwingStorage(), () => {
    assert.deepEqual(readLocal("user_1"), {});
  });
});

test("writeLocal: blocked storage is swallowed instead of throwing", async () => {
  const { writeLocal } = await import("./JournalEditor.tsx");
  withFakeLocalStorage(throwingStorage(), () => {
    assert.doesNotThrow(() => writeLocal("user_1", {}));
  });
});

test("readLocal/writeLocal: working storage round-trips normally (no regression from the guard)", async () => {
  const { readLocal, writeLocal } = await import("./JournalEditor.tsx");
  withFakeLocalStorage(workingStorage(), () => {
    const now = new Date().toISOString();
    writeLocal("user_1", { "42": { open_play_id: 42, note: "chased it", tags: ["chased"], updated_at: now } });
    const map = readLocal("user_1");
    assert.equal(map["42"]?.note, "chased it");
  });
});

test("readLocal: off the browser (SSR) returns an empty map and never throws", async () => {
  const { readLocal } = await import("./JournalEditor.tsx");
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  try {
    assert.deepEqual(readLocal("user_1"), {});
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
