> **kind:** FINDING

## `client-server-boundary.mjs` never follows `export ... from` re-export edges — FIXED

| Field | Detail |
|---|---|
| **Area** | `scripts/audit/client-server-boundary.mjs` (CI-time checker: does any `"use client"` module transitively reach `import "server-only"`) |
| **Severity** | P3 (audit-tooling correctness — a silent false negative in a guard whose entire job is catching a `next build` failure before the ~3.5-minute test run) |
| **Status** | FIXED in this PR |

### Root cause

`runtimeImports(source)` is the sole edge-extractor the BFS in `traceToServerOnly` walks. It scanned
three import shapes — named `import { X } from "..."`, bare `import "..."`, and dynamic
`import("...")` — and deliberately excludes `import type` / type-only clauses (the tool's own header
documents getting that erasure right as lesson #1).

It never scanned ES module **re-export** syntax at all: `export { X } from "..."`,
`export * from "..."`, `export * as X from "..."`. These create the exact same runtime dependency
edge as an `import ... from` — the target module is evaluated and its binding re-exported — so a
`"use client"` file (or any file in the transitive chain) that reaches `server-only` purely through
a re-export was invisible to the checker: `runtimeImports()` returned zero edges for that line, so
`traceToServerOnly`'s BFS never even enqueued the re-exported module, and the script printed
`client/server boundary OK` on a tree whose `next build` would genuinely fail — the precise failure
mode the tool exists to catch (see its own header: `next build` is the only thing that resolves the
full module graph, and it runs last in `verify`, after a long test run).

This is a real, present pattern in the repo, not a hypothetical one: `src/app/error.tsx` and
`src/app/(site)/error.tsx` (both `"use client"`) are written as
`export { default } from "@/components/route-error-boundary";` — a re-export is literally how two
real client entry points in this codebase reach their implementation. In this specific instance the
re-exported module happens not to reach `server-only`, so today's live tree reports clean either way
— but the checker's coverage of that edge shape was zero, and any future PR that re-exports from a
module reaching `server-only` (instead of using a plain `import`) would ship past this guard
undetected, exactly the way the original 2026-08-20 incident this tool was built to prevent slipped
past `tsc --noEmit` and the unit suite.

### Evidence

Before the fix, `runtimeImports` returned `[]` for every one of these inputs (confirmed via
`git stash` RED→GREEN in `scripts/audit/client-server-boundary.test.mjs`):

```js
runtimeImports('"use client";\nexport { Thing } from "./middle";\n')              // -> [] (wrong, should be ["./middle"])
runtimeImports('"use client";\nexport * from "./middle";\n')                       // -> [] (wrong)
runtimeImports('"use client";\nexport * as Middle from "./middle";\n')             // -> [] (wrong)
runtimeImports('"use client";\n\nexport { default } from "@/components/route-error-boundary";\n') // -> [] (wrong)
```

5 of 6 new regression cases failed before the fix; the 6th (an all-type-only named re-export,
`export type { X } from`, which must stay erased exactly like `import type`) already passed,
confirming the fix only adds the missing edge type rather than over-counting.

Post-fix, a full run against the live tree (`node scripts/audit/client-server-boundary.mjs`) still
reports `client/server boundary OK — 370 "use client" modules, none reach server-only` — the new
scan adds real coverage without introducing any false positive against today's actual tree.

### Blast radius

Single file: `scripts/audit/client-server-boundary.mjs`'s `runtimeImports()` is the only edge
extractor in the file, used by `traceToServerOnly`'s BFS, which is the whole of this script's
detection logic. No other script imports or duplicates this function.

### Fix rationale

Added a fourth regex pass, mirroring the existing named-import erasure logic exactly (same
all-type-clause check, same comment style) rather than inventing a new rule: `export type { X } from`
and an all-`type`-prefixed named clause are excluded (erased before bundling, like `import type`); a
mixed clause (`export { type A, B } from`) still counts, since `B` is a genuine runtime binding.
`export *`/`export * as X` have no clause to inspect and are always runtime (TypeScript has no
`export type * from` erasure-only form in this codebase's target). Left the existing three import
scans, the dynamic-import type-query handling, and the BFS itself untouched — this only closes the
missing edge-extraction gap, it does not change how traces are reported or deduplicated.
