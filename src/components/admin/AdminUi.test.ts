import { test } from "node:test";
import assert from "node:assert/strict";
import { readDeckPanelState, writeDeckPanelState } from "./AdminUi";

function withThrowingSessionStorage<T>(fn: () => T): T {
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

test("readDeckPanelState: a thrown sessionStorage access degrades to null, not an uncaught throw", () => {
  const result = withThrowingSessionStorage(() => readDeckPanelState("some-panel"));
  assert.equal(result, null);
});

test("writeDeckPanelState: a thrown sessionStorage access is swallowed, not an uncaught throw", () => {
  assert.doesNotThrow(() => withThrowingSessionStorage(() => writeDeckPanelState("some-panel", "open")));
});

test("readDeckPanelState/writeDeckPanelState: round-trip through a working sessionStorage", () => {
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
  try {
    assert.equal(readDeckPanelState("some-panel"), null);
    writeDeckPanelState("some-panel", "open");
    assert.equal(readDeckPanelState("some-panel"), "open");
    writeDeckPanelState("some-panel", "closed");
    assert.equal(readDeckPanelState("some-panel"), "closed");
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});

test("readDeckPanelState: a malformed/unexpected stored value reads as null, not passed through", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => "garbage" },
  });
  try {
    assert.equal(readDeckPanelState("some-panel"), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});
