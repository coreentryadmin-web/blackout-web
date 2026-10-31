import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MASSIVE_WS_STOCKS,
  MASSIVE_WS_OPTIONS,
  MASSIVE_WS_INDICES,
} from "./polygon-docs-nav";

// Regression for the three constants this module exists to share — each one has a real
// consumer (stocks-socket.ts / options-socket.ts / polygon-socket.ts), so their values must
// stay the live Massive WS endpoints, not drift or get hollowed out by a future edit.
test("the three live MASSIVE_WS_* constants point at the real Massive WebSocket endpoints", () => {
  assert.equal(MASSIVE_WS_STOCKS, "wss://socket.massive.com/stocks");
  assert.equal(MASSIVE_WS_OPTIONS, "wss://socket.massive.com/options");
  assert.equal(MASSIVE_WS_INDICES, "wss://socket.massive.com/indices");
});

/**
 * Regression for the finding this test file ships with: `MASSIVE_DOCS_BASE` and
 * `MASSIVE_REST_BASE` were real, imported constants until the `/docs/polygon/*` route tree
 * that consumed them was deleted (`de9b1967f`, "delete the stale /docs/* analysis app routes").
 * A later, unrelated dead-code pass (#5768) removed a different dead export from this same
 * file and its own commit message asserted "left the file's 5 live MASSIVE_* constants ...
 * untouched" — which was wrong for these two: they had already been orphaned, and that pass
 * never re-verified each constant's consumers individually. Pin the export surface here so a
 * reintroduced "convenience" constant with no real caller doesn't slip back in the same way.
 */
test("polygon-docs-nav.ts exports only the three constants that have a real consumer", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/polygon-docs-nav.ts"), "utf8");
  const exported = [...src.matchAll(/^export const ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  assert.deepEqual(
    exported.sort(),
    ["MASSIVE_WS_INDICES", "MASSIVE_WS_OPTIONS", "MASSIVE_WS_STOCKS"].sort(),
    "polygon-docs-nav.ts must export exactly the three MASSIVE_WS_* constants consumed by " +
      "stocks-socket.ts/options-socket.ts/polygon-socket.ts — no orphaned docs-route constant"
  );
});

test("no source file in the repo still references the removed MASSIVE_DOCS_BASE/MASSIVE_REST_BASE constants", () => {
  // Guards against a stale re-import if the removed constants' names resurface in a merge/rebase.
  const root = process.cwd();
  const checkFiles = [
    "src/lib/ws/stocks-socket.ts",
    "src/lib/ws/options-socket.ts",
    "src/lib/ws/polygon-socket.ts",
  ];
  for (const f of checkFiles) {
    const content = readFileSync(join(root, f), "utf8");
    assert.doesNotMatch(content, /MASSIVE_DOCS_BASE|MASSIVE_REST_BASE/, `${f} must not import the removed constants`);
  }
});
