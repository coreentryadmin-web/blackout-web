/**
 * Regression guard for the ChunkLoadError self-heal (2026-08-24): a client that loaded its HTML
 * from one ECS task hits a JS chunk whose content-hashed filename rotated because a newer deploy
 * replaced that task mid-request. Reproduced live: `/heatmap` crashed to `global-error.tsx`'s
 * full "CRITICAL ERROR" screen (2 of 4 attempts) during a window with an in-progress production
 * deploy, console carrying `ChunkLoadError: Loading chunk 6750 failed.` A retry with no deploy in
 * flight loaded cleanly — the chunk is transiently missing, not permanently broken, so a hard
 * reload (fetching the current HTML + manifest) clears it automatically instead of leaving the
 * member on a manual "Try again" for a problem their own next load would have avoided.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isChunkLoadError, autoReloadOnceOnChunkError } from "./chunk-load-error";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("isChunkLoadError: recognizes the browser's own ChunkLoadError by name", () => {
  const err = new Error("Loading chunk 6750 failed.\n(error: https://example.com/chunk.js)");
  err.name = "ChunkLoadError";
  assert.equal(isChunkLoadError(err), true);
});

test("isChunkLoadError: recognizes the message pattern even if .name wasn't set (older browsers/polyfills)", () => {
  const err = new Error("Loading chunk 42 failed.");
  assert.equal(isChunkLoadError(err), true);
});

test("isChunkLoadError: does NOT match an unrelated error — no reload loop for a real bug", () => {
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of null")), false);
  assert.equal(isChunkLoadError(new Error("Network request failed")), false);
  assert.equal(isChunkLoadError("Loading chunk 5 failed."), false); // not an Error instance
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
});

function fakeWindow() {
  const store = new Map<string, string>();
  const reloadCalls: number[] = [];
  return {
    win: {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      location: { reload: () => void reloadCalls.push(1) },
    },
    reloadCalls,
  };
}

test("autoReloadOnceOnChunkError: reloads once for a chunk error", () => {
  const { win, reloadCalls } = fakeWindow();
  const err = new Error("Loading chunk 6750 failed.");
  err.name = "ChunkLoadError";
  autoReloadOnceOnChunkError(err, win);
  assert.equal(reloadCalls.length, 1);
});

test("autoReloadOnceOnChunkError: does not reload a second time in the same session (no infinite loop)", () => {
  const { win, reloadCalls } = fakeWindow();
  const err = new Error("Loading chunk 6750 failed.");
  err.name = "ChunkLoadError";
  autoReloadOnceOnChunkError(err, win);
  autoReloadOnceOnChunkError(err, win);
  assert.equal(reloadCalls.length, 1, "a genuinely broken deploy must fall through to the manual Try Again, not loop forever");
});

test("autoReloadOnceOnChunkError: never reloads for a non-chunk error", () => {
  const { win, reloadCalls } = fakeWindow();
  autoReloadOnceOnChunkError(new TypeError("Cannot read properties of null"), win);
  assert.equal(reloadCalls.length, 0);
});

test("autoReloadOnceOnChunkError: never throws when sessionStorage access throws (private mode)", () => {
  const win = {
    sessionStorage: {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    },
    location: { reload: () => assert.fail("must not reload if storage access failed") },
  };
  const err = new Error("Loading chunk 1 failed.");
  err.name = "ChunkLoadError";
  assert.doesNotThrow(() => autoReloadOnceOnChunkError(err, win));
});

test("global-error.tsx: still imports nothing but react and its own inlined chunk-error check", () => {
  const src = read("src/app/global-error.tsx");
  assert.doesNotMatch(src, /^import(?!.*from ["']react["'])/m, "must not add non-react imports — this boundary must load even if a sibling chunk failed");
  assert.match(src, /isChunkLoadError/, "must still self-heal on a stale chunk (inlined, not imported)");
  assert.match(src, /window\.location\.reload/);
});

test("route-error-boundary.tsx: wired to the shared chunk-error self-heal", () => {
  const src = read("src/components/route-error-boundary.tsx");
  assert.match(src, /autoReloadOnceOnChunkError/);
});
