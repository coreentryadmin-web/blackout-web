/**
 * Regression: `runtimeImports` must also follow RE-EXPORT edges (`export { X } from "..."`,
 * `export * from "..."`, `export * as X from "..."`), not just `import ... from "..."`.
 *
 * WHY THIS MATTERS: `traceToServerOnly`'s BFS walks a file's edges via `importsOf()` ->
 * `runtimeImports()`. A re-export is a genuine runtime dependency — the module is evaluated and
 * its binding re-exported, exactly like `import { X } from "./middle"; export { X };` — but
 * before this fix the extractor only scanned `import` syntax, so a chain like:
 *
 *   "use client" entry file:  export { Thing } from "./middle";
 *   ./middle.ts:               import "server-only";
 *
 * produced ZERO detected edges from the entry file, so `traceToServerOnly` never even looked at
 * `./middle.ts` and the checker reported "client/server boundary OK" on a tree whose `next build`
 * would actually fail — the exact silent-false-negative failure mode this tool's own header
 * describes fixing for `import type` and dynamic imports, left open for `export ... from`.
 *
 * `export type { X } from "..."` (and an all-type named clause) must stay excluded, same as the
 * existing `import type` handling, since it is fully erased before bundling.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runtimeImports } from "./client-server-boundary.mjs";

test("named re-export (`export { X } from`) is followed as a runtime edge", () => {
  const src = `"use client";\nexport { Thing } from "./middle";\n`;
  assert.deepEqual(runtimeImports(src), ["./middle"]);
});

test("wildcard re-export (`export * from`) is followed as a runtime edge", () => {
  const src = `"use client";\nexport * from "./middle";\n`;
  assert.deepEqual(runtimeImports(src), ["./middle"]);
});

test("namespaced wildcard re-export (`export * as X from`) is followed as a runtime edge", () => {
  const src = `"use client";\nexport * as Middle from "./middle";\n`;
  assert.deepEqual(runtimeImports(src), ["./middle"]);
});

test("an ALL-type named re-export (`export type { X } from`) is erased, not followed", () => {
  const src = `"use client";\nexport type { Thing } from "./middle";\n`;
  assert.deepEqual(runtimeImports(src), []);
});

test("a mixed named re-export (`export { type A, B } from`) still counts — B is runtime", () => {
  const src = `"use client";\nexport { type A, B } from "./middle";\n`;
  assert.deepEqual(runtimeImports(src), ["./middle"]);
});

test("real repo pattern: error.tsx's `export { default } from \"@/components/...\"` is followed", () => {
  const src = `"use client";\n\nexport { default } from "@/components/route-error-boundary";\n`;
  assert.deepEqual(runtimeImports(src), ["@/components/route-error-boundary"]);
});
