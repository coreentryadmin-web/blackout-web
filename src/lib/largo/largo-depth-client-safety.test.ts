import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { normalizeLargoDepth, parseLargoDepth } from "./largo-depth-mode";

/**
 * A client module must not reach `server-only` through the answer-mode helpers.
 *
 * `largo-depth.ts` imports COMMENTARY_MODEL / LARGO_MODEL from providers/anthropic, which reaches
 * api-telemetry -> api-telemetry-persist, and that file begins with `import "server-only"`. So the
 * first VALUE import from `largo-depth.ts` inside a client component pulls server-only into the
 * browser bundle and FAILS THE NEXT BUILD:
 *
 *   ./src/lib/api-telemetry-persist.ts
 *   Error: You're importing a component that needs "server-only".
 *   Import trace: largo-depth.ts -> useLargoChat.ts -> LargoNativeTerminal.tsx -> LargoPageShell.tsx
 *
 * That is invisible to `tsc` and to the unit suite — both passed clean (8513/0) on the commit that
 * broke the build. Only the bundler resolves the graph, so only `npm run build` caught it. This
 * test moves the check into the suite by walking the import graph itself.
 *
 * NOTE the type-vs-value distinction, which is the easy thing to get wrong here: `import type`
 * is erased before bundling, so the components doing `import type { LargoDepth }` were never the
 * problem. Only a runtime import breaks it.
 */

const SRC = join(process.cwd(), "src");
const CLIENT_SAFE = "src/lib/largo/largo-depth-mode.ts";

/** Strip comments so a guard never matches its own explanation. */
function codeOnly(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function resolveLocal(spec: string, fromFile: string): string | null {
  // BOTH specifier forms matter. The chain that actually broke the build ends in a RELATIVE
  // dynamic import — `import("./api-telemetry-persist")` inside api-telemetry.ts — so an
  // alias-only resolver walks right past the edge it is meant to find.
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null;
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Runtime imports only — `import type` is erased by the bundler and cannot drag server-only in. */
function runtimeImports(file: string): string[] {
  const src = codeOnly(readFileSync(file, "utf8"));
  const out: string[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const isTypeOnly = Boolean(m[1]);
    const clause = m[2] ?? "";
    // `import { type A, type B }` is also fully erased.
    const allInlineType =
      clause.trim().startsWith("{") &&
      clause
        .replace(/[{}]/g, "")
        .split(",")
        .filter((p) => p.trim())
        .every((p) => p.trim().startsWith("type "));
    if (isTypeOnly || allInlineType) continue;
    out.push(m[3]!);
  }
  // side-effect imports: import "server-only"
  const bare = /import\s+["']([^"']+)["']/g;
  while ((m = bare.exec(src))) out.push(m[1]!);
  // DYNAMIC imports. webpack still bundles these for the client, so `void import("./x")` pulls
  // x into the browser chunk exactly like a static import would. Omitting them is what made the
  // first version of this walker report a clean graph on a tree whose build was failing.
  const dyn = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dyn.exec(src))) out.push(m[1]!);
  return out;
}

function reachesServerOnly(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; path: string[] }> = [{ file: entry, path: [entry] }];
  while (stack.length) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec === "server-only") return [...path, "server-only"];
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) stack.push({ file: next, path: [...path, next] });
    }
  }
  return null;
}

test("REGRESSION: the client-safe answer-mode module never reaches server-only", () => {
  const entry = join(process.cwd(), CLIENT_SAFE);
  assert.ok(existsSync(entry), `${CLIENT_SAFE} must exist`);
  const trace = reachesServerOnly(entry);
  assert.equal(
    trace,
    null,
    trace ? `client-safe module reaches server-only:\n  ${trace.join("\n  → ")}` : ""
  );
});

test("REGRESSION: the client chat hook does not take a VALUE import from largo-depth.ts", () => {
  // The exact edge that broke the build. A type-only import here is fine and is not flagged.
  const hook = join(process.cwd(), "src/hooks/useLargoChat.ts");
  const specs = runtimeImports(hook);
  assert.ok(
    !specs.includes("@/lib/largo/largo-depth"),
    "useLargoChat must import mode helpers from largo-depth-mode, not largo-depth"
  );
});

test("largo-depth.ts itself DOES still reach server-only — the split is load-bearing, not cosmetic", () => {
  // If this ever stops being true the two modules could be recombined; until then, keeping them
  // apart is the only thing holding the build up. Asserting it stops the split from being
  // "tidied away" by someone who cannot see why it exists.
  const trace = reachesServerOnly(join(process.cwd(), "src/lib/largo/largo-depth.ts"));
  assert.ok(trace, "expected largo-depth.ts to reach server-only via providers/anthropic");
});

test("the mode parsers still behave, including the legacy value", () => {
  assert.equal(normalizeLargoDepth("concrete"), "concrete");
  assert.equal(normalizeLargoDepth("quick"), "concrete", "legacy storage value maps to Concrete");
  assert.equal(normalizeLargoDepth("deep"), "deep");
  assert.equal(normalizeLargoDepth(undefined), "deep", "unset falls back to Deep dive");
  assert.equal(normalizeLargoDepth("nonsense"), "deep");
  assert.equal(parseLargoDepth("quick"), "concrete");
});

test("largo-depth re-exports the parsers so server-side import paths keep working", () => {
  const src = codeOnly(readFileSync(join(process.cwd(), "src/lib/largo/largo-depth.ts"), "utf8"));
  assert.match(src, /export\s*\{[^}]*normalizeLargoDepth[^}]*\}\s*from\s*["']@\/lib\/largo\/largo-depth-mode["']/);
  assert.match(src, /export\s+type\s*\{[^}]*LargoDepth[^}]*\}\s*from\s*["']@\/lib\/largo\/largo-depth-mode["']/);
});
