/**
 * Regression guard for the ChunkLoadError self-heal (2026-08-24): a client that loaded its HTML
 * from one ECS task hits a JS chunk whose content-hashed filename rotated because a newer deploy
 * replaced that task mid-request. Reproduced live: `/heatmap` crashed to `global-error.tsx`'s
 * full "CRITICAL ERROR" screen (2 of 4 attempts) during a window with an in-progress production
 * deploy, console carrying `ChunkLoadError: Loading chunk 6750 failed.` A retry with no deploy in
 * flight loaded cleanly — the chunk is transiently missing, not permanently broken, so a hard
 * reload (fetching the current HTML + manifest) clears it automatically instead of leaving the
 * member on a manual "Try again" for a problem their own next load would have avoided.
 *
 * **2026-10-14 addition**: the guard above was a bare "have I ever reloaded in this tab" flag
 * that, once set, never cleared — so a session that self-healed from ONE chunk failure could never
 * self-heal from a SECOND, unrelated one later (e.g. a different desk, a later deploy) in the same
 * tab; it fell straight to the manual "Try again" dead end instead. Fixed by scoping the guard to
 * the build id it fired for (mirroring the older, canonical `chunk-reload.ts` inline-script guard,
 * which already had this right). The new tests below prove the RED→GREEN: multi-incident recovery
 * across different build ids now self-heals, while same-build-id repeats and the no-document
 * fallback still protect against an infinite reload loop exactly as before.
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

test("isChunkLoadError: widened to the shared canonical pattern — not just the bare ChunkLoadError subset", () => {
  // These are real sibling deploy-skew failures `chunk-reload.ts`'s canonical pattern already
  // recognizes (see its own test). A React error boundary can be the ONLY thing that ever sees one
  // of these (e.g. a rejected `next/dynamic` loader surfaces as a render-phase throw, never an
  // `unhandledrejection` the inline head-script listener would catch) — so this layer under-
  // matching them meant some genuinely missed a self-heal, not just a slower one.
  assert.equal(isChunkLoadError(new Error("Loading CSS chunk 12 failed.")), true);
  assert.equal(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/y.js")), true);
  assert.equal(
    isChunkLoadError(new Error("Refused to execute script from '.../chunks/5784.js' because its MIME type ('text/plain') is not executable")),
    true
  );
  assert.equal(
    isChunkLoadError(new Error('UnrecognizedActionError: Server Action "abc123" was not found on the server.')),
    true
  );
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

/** Same as `fakeWindow()`, plus a `document.querySelector` stub reporting the given build id off a
 * `/_next/static/<buildId>/...` script src, the same signal `currentBuildId` reads in production. */
function fakeWindowWithBuildId(buildId: string) {
  const base = fakeWindow();
  return {
    ...base,
    win: {
      ...base.win,
      document: {
        querySelector: (selector: string) =>
          selector.includes("/_next/static/") ? { src: `https://example.com/_next/static/${buildId}/webpack-abc.js` } : null,
      },
    },
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

test("autoReloadOnceOnChunkError: does not reload a second time for the SAME build id (no infinite loop, build-id-scoped)", () => {
  const { win, reloadCalls } = fakeWindowWithBuildId("build-A");
  const err = new Error("Loading chunk 6750 failed.");
  err.name = "ChunkLoadError";
  autoReloadOnceOnChunkError(err, win);
  autoReloadOnceOnChunkError(err, win);
  assert.equal(reloadCalls.length, 1, "a second failure on the SAME build must not re-trigger a reload loop");
});

test("autoReloadOnceOnChunkError: self-heals a SECOND, unrelated chunk failure once a NEWER build has loaded (the fixed bug)", () => {
  // Reproduces "a session opened before deployment can still navigate between desks afterward":
  // one chunk failure self-heals (reload #1, on the build live when it fired); the tab lands on a
  // fresh build; navigating to a DIFFERENT desk later hits its own, unrelated chunk failure on
  // that newer build — this must ALSO self-heal (reload #2), not silently inherit a spent flag
  // from the first, completely unrelated incident. Before the fix, reload #2 never fired.
  const { win, reloadCalls } = fakeWindow();
  const document = {
    buildId: "build-A",
    querySelector(selector: string) {
      return selector.includes("/_next/static/")
        ? { src: `https://example.com/_next/static/${this.buildId}/webpack-abc.js` }
        : null;
    },
  };
  const winWithDocument = { ...win, document };

  const err1 = new Error("Loading chunk 100 failed.");
  err1.name = "ChunkLoadError";
  autoReloadOnceOnChunkError(err1, winWithDocument);
  assert.equal(reloadCalls.length, 1, "first incident (build-A) must self-heal");

  // Simulate the reload actually landing on a newer build (a real deploy shipped meanwhile).
  document.buildId = "build-B";

  const err2 = new Error("Loading chunk 200 failed.");
  err2.name = "ChunkLoadError";
  autoReloadOnceOnChunkError(err2, winWithDocument);
  assert.equal(reloadCalls.length, 2, "second incident on a NEWER build (build-B) must also self-heal, not inherit build-A's spent flag");

  // And a THIRD failure on that SAME build-B must still not loop.
  autoReloadOnceOnChunkError(err2, winWithDocument);
  assert.equal(reloadCalls.length, 2, "a repeat failure on the same build-B must not loop");
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

test("global-error.tsx: inlined reload guard is build-id-scoped, not a bare ever-reloaded flag", () => {
  // Same root-cause fix as chunk-load-error.ts, mirrored inline here (this boundary can't import
  // it — see the "no imports beyond react" rule) — proves the duplicate copy didn't keep the bug.
  const src = read("src/app/global-error.tsx");
  assert.match(src, /currentBuildId/, "must read the current build id, the same signal chunk-reload.ts/chunk-load-error.ts use");
  assert.match(
    src,
    /stored && \(!buildId \|\| stored === buildId\)/,
    "the guard must only skip a reload when it already fired for THIS build id, not forever"
  );
});

test("route-error-boundary.tsx: wired to the shared chunk-error self-heal", () => {
  const src = read("src/components/route-error-boundary.tsx");
  assert.match(src, /autoReloadOnceOnChunkError/);
});
