import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { runtimeImports } from "../scripts/audit/client-server-boundary.mjs";

/**
 * No `"use client"` module may reach `import "server-only"`.
 *
 * This class of bug is invisible to BOTH other gates. On 2026-08-20 a Largo change added the first
 * runtime import from `largo-depth.ts` into a client hook; `tsc --noEmit` was clean and the unit
 * suite was 8513 pass / 0 fail on that exact commit, and `next build` still failed:
 *
 *   ./src/lib/api-telemetry-persist.ts
 *   Error: You're importing a component that needs "server-only".
 *
 * Only the bundler resolves the module graph. `npm run build` is the LAST step of `verify`, so the
 * feedback arrived ~4 minutes in, in CI, with no local reproduction. This runs the same check in
 * about a second and prints the offending import chain.
 *
 * The checker is mutation-tested, not just asserted-green: re-pointing useLargoChat's
 * `normalizeLargoDepth` import back at `largo-depth.ts` reproduces CI's exact trace
 * (LargoPageShell -> LargoNativeTerminal -> useLargoChat -> largo-depth -> providers/anthropic ->
 * api-telemetry -> api-telemetry-persist -> server-only) and exits 1. A guard that has only ever
 * been observed passing is not known to detect anything.
 */

const ROOT = join(import.meta.dirname, "..");

test("no client module reaches server-only", () => {
  // Runs the committed script so the test and the standalone audit tool can never drift apart.
  try {
    const out = execFileSync("node", [join(ROOT, "scripts/audit/client-server-boundary.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(out, /client\/server boundary OK/);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    assert.fail(`client/server boundary violated:\n${err.stderr ?? ""}${err.stdout ?? ""}`);
  }
});

/**
 * The parser's two hard cases. Both were wrong in the first draft, and each failure mode is worse
 * in a different direction — one cries wolf on a healthy tree, the other passes a broken one.
 */
test("type-only imports are NOT edges — they are erased before bundling", () => {
  // Counting these reported 76 violations against a tree whose build was green.
  assert.deepEqual(runtimeImports(`import type { A } from "@/lib/a";`), []);
  assert.deepEqual(runtimeImports(`import { type A, type B } from "@/lib/a";`), []);
  // The exact shape src/lib/api.ts uses on purpose to keep server-only out of the client bundle:
  assert.deepEqual(
    runtimeImports(`const x = marketFetch<import("@/features/spx/lib/spx-pin").SpxPinForecast>("/spx/pin");`),
    []
  );
  assert.deepEqual(runtimeImports(`type T = typeof import("@/lib/server-thing");`), []);
});

test("runtime imports ARE edges — static, side-effect, relative and dynamic alike", () => {
  // The edge that actually broke the build is relative AND dynamic: an alias-only, static-only
  // walker reports a clean graph on a failing tree, which is the more dangerous mistake.
  assert.deepEqual(runtimeImports(`import { a } from "@/lib/a";`), ["@/lib/a"]);
  assert.deepEqual(runtimeImports(`import "server-only";`), ["server-only"]);
  assert.deepEqual(runtimeImports(`void import("./api-telemetry-persist");`), ["./api-telemetry-persist"]);
  assert.deepEqual(runtimeImports(`await import("../x/y");`), ["../x/y"]);
  assert.deepEqual(runtimeImports(`import("./x").then(m => m.go());`), ["./x"]);
  // A default + named mix is still a value import.
  assert.deepEqual(runtimeImports(`import D, { n } from "@/lib/d";`), ["@/lib/d"]);
});

test("commented-out imports are not edges", () => {
  // Otherwise a guard can match its own explanation, or a dead line resurrects a false positive.
  assert.deepEqual(runtimeImports(`// import { a } from "@/lib/a";`), []);
  assert.deepEqual(runtimeImports(`/* import "server-only"; */`), []);
});
