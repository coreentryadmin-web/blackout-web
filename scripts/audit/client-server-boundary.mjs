#!/usr/bin/env node
/**
 * Client/server boundary checker — does any `"use client"` module reach `import "server-only"`?
 *
 * WHY THIS EXISTS. On 2026-08-20 a Largo change added the first RUNTIME import from
 * `largo-depth.ts` into a client hook. That module reaches providers/anthropic -> api-telemetry ->
 * `import("./api-telemetry-persist")`, which begins `import "server-only"`, so `next build` failed:
 *
 *   ./src/lib/api-telemetry-persist.ts
 *   Error: You're importing a component that needs "server-only".
 *
 * `tsc --noEmit` was clean and the full unit suite was 8513/0 on the same commit. Only the bundler
 * resolves the module graph, so only `npm run build` caught it — the LAST step of `verify`, after
 * a ~3.5 minute test run. This moves the same check to the front, with a precise import trace.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, both learned by getting them wrong:
 *
 *   1. `import type` is ERASED before bundling. Several components legitimately do
 *      `import type { LargoDepth } from ".../largo-depth"` and are not the problem. A checker that
 *      counts type imports reports failures on a tree that builds fine — noise that trains people
 *      to ignore it.
 *   2. RELATIVE and DYNAMIC specifiers count. The edge that actually broke the build is
 *      `void import("./api-telemetry-persist")` — relative AND dynamic. An alias-only, static-only
 *      walker reports a CLEAN graph on a tree whose build is failing, which is the worse failure:
 *      a green check that proves nothing.
 *
 * Exits non-zero and prints the offending trace. Run: node scripts/audit/client-server-boundary.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Strip comments so a guard never matches its own explanation, and so a commented-out
 *  import is not counted as a real edge. */
function codeOnly(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function resolveLocal(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null;
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Runtime imports only. Type-only imports cannot pull anything into the bundle. */
export function runtimeImports(source) {
  const src = codeOnly(source);
  const out = [];
  let m;

  const named = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  while ((m = named.exec(src))) {
    if (m[1]) continue; // `import type { X } from`
    const clause = (m[2] ?? "").trim();
    // `import { type A, type B } from` is also fully erased.
    if (clause.startsWith("{")) {
      const parts = clause.replace(/[{}]/g, "").split(",").filter((p) => p.trim());
      if (parts.length && parts.every((p) => p.trim().startsWith("type "))) continue;
    }
    out.push(m[3]);
  }

  const bare = /import\s+["']([^"']+)["']/g;
  while ((m = bare.exec(src))) out.push(m[1]);

  // Dynamic imports — but ONLY the runtime ones. TypeScript also spells a TYPE reference as
  // `import("@/x").SomeType` (and `typeof import("@/x")`), which is erased exactly like
  // `import type`. src/lib/api.ts uses that form deliberately, with a comment saying so:
  //
  //   // Inline type import keeps the server-only spx-pin module out of the client bundle
  //   marketFetch<import("@/features/spx/lib/spx-pin").SpxPinForecast>("/spx/pin")
  //
  // Counting those reported 76 violations against a tree whose build is green — every one of
  // them routed through that single line. A checker that cries wolf on a healthy tree is worse
  // than no checker, because the next real hit gets waved through with the noise.
  //
  // Distinguishing rule: a trailing `.member` marks a type query, EXCEPT the promise methods,
  // which mark a genuine runtime import (`import("./x").then(...)`).
  const dyn = /(typeof\s+)?\bimport\s*\(\s*["']([^"']+)["']\s*\)\s*(\.\s*([A-Za-z_$][\w$]*))?/g;
  while ((m = dyn.exec(src))) {
    const isTypeof = Boolean(m[1]);
    const member = m[4];
    const isPromiseMethod = member === "then" || member === "catch" || member === "finally";
    if (isTypeof) continue;
    if (member && !isPromiseMethod) continue; // `import("x").SomeType` — a type query
    out.push(m[2]);
  }

  return out;
}

const cache = new Map();
function importsOf(file) {
  if (!cache.has(file)) cache.set(file, runtimeImports(readFileSync(file, "utf8")));
  return cache.get(file);
}

/** BFS so the reported trace is the SHORTEST path — the most actionable one to cut. */
function traceToServerOnly(entry) {
  const seen = new Set([entry]);
  const queue = [[entry]];
  while (queue.length) {
    const path = queue.shift();
    const file = path[path.length - 1];
    for (const spec of importsOf(file)) {
      if (spec === "server-only") return [...path, "server-only"];
      const next = resolveLocal(spec, file);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

// Guarded so importing this module (the unit test does, to reuse `runtimeImports`) does not run
// the scan and call process.exit — which silently truncated the test file to its first case.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) main();

function main() {
const files = walkFiles(SRC).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
const clientFiles = files.filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")));

const violations = [];
for (const f of clientFiles) {
  const trace = traceToServerOnly(f);
  if (trace) violations.push(trace.map((p) => (p === "server-only" ? p : relative(ROOT, p))));
}

if (violations.length === 0) {
  console.log(`client/server boundary OK — ${clientFiles.length} "use client" modules, none reach server-only`);
  process.exit(0);
}

console.error(`client/server boundary VIOLATIONS: ${violations.length}\n`);
for (const t of violations) console.error("  " + t.join("\n    → ") + "\n");
console.error("Each of these fails `next build`. Cut the first edge that pulls a server value into");
console.error("a client module — usually by splitting the client-safe half into its own module.");
process.exit(1);
}
