import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readSpxMatrixLensFromSession,
  SPX_MATRIX_LENS_STORAGE_KEY,
  writeSpxMatrixLensToSession,
} from "@/features/spx/lib/spx-matrix-lens";

test("readSpxMatrixLensFromSession defaults to gex when storage empty", () => {
  const store = new Map<string, string>();
  const g = globalThis as typeof globalThis & { window?: { sessionStorage: Storage } };
  const prev = g.window;
  g.window = {
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(readSpxMatrixLensFromSession(), "gex");
  writeSpxMatrixLensToSession("vex");
  assert.equal(store.get(SPX_MATRIX_LENS_STORAGE_KEY), "vex");
  assert.equal(readSpxMatrixLensFromSession(), "vex");

  g.window = prev;
});
