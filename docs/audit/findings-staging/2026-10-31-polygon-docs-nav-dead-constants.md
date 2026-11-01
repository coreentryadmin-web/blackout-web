# 2026-10-31 polygon-docs-nav.ts: `MASSIVE_DOCS_BASE`/`MASSIVE_REST_BASE` orphaned since the `/docs/*` route deletion, missed by a prior cleanup pass

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead-code removal (confirmed zero behavior change) |

## Root cause

`src/lib/polygon-docs-nav.ts` exported five constants. Only three have a real consumer today:

- `MASSIVE_WS_STOCKS` — imported by `src/lib/ws/stocks-socket.ts`.
- `MASSIVE_WS_OPTIONS` — imported by `src/lib/ws/options-socket.ts`.
- `MASSIVE_WS_INDICES` — imported by `src/lib/ws/polygon-socket.ts`.

The other two, `MASSIVE_DOCS_BASE` and `MASSIVE_REST_BASE`, had **zero references anywhere in the
repository** (verified with a repo-wide grep across `.ts`/`.tsx`/`.mjs`/`.js`/`.json`, matching only
their own `export const` lines).

These two were not dead-on-arrival — `git log --all -S"MASSIVE_REST_BASE"` shows they were real,
imported constants, consumed by the `/docs/polygon/*` internal reference-nav route tree
(`src/app/docs/polygon/page.tsx`, `src/app/docs/polygon/rest/stocks/page.tsx`, etc.) added in
`e7d9fe5f4`. That whole route tree was deleted in `de9b1967f` ("chore(docs): delete the stale
`/docs/*` analysis app routes (IP-leak surface, ~7.6k LOC)"), which is exactly where
`MASSIVE_DOCS_BASE`/`MASSIVE_REST_BASE` lost their only callers — confirmed by diffing that commit:
`src/app/docs/polygon/page.tsx` imported and rendered `{MASSIVE_REST_BASE}` directly, and
`src/app/docs/polygon/rest/stocks/page.tsx` imported both `MASSIVE_DOCS_BASE` and
`MASSIVE_REST_BASE` for its example `href`/code snippet.

**This is the previously-undetected part**: a later, unrelated dead-code pass (`#5768`,
`b49823349`, "remove unused Polygon docs-nav tree from polygon-docs-nav.ts") removed a *different*
dead export from this same file (`PolygonDocLink`/`PolygonDocSection`/`POLYGON_DOCS_SECTIONS`,
dead-on-arrival since `e7d9fe5f4` and never wired to anything) — and its own commit message
asserted *"Left the file's 5 live MASSIVE_* constants (consumed by stocks-socket.ts and
options-socket.ts) untouched."* That claim bundled all five remaining constants together as "live"
without re-verifying each one's consumers individually post-route-deletion. Three of the five
(`MASSIVE_WS_STOCKS`/`MASSIVE_WS_OPTIONS`/`MASSIVE_WS_INDICES`) genuinely are live; the other two
had already been orphaned by the `/docs/*` deletion two commits earlier in the same history and
that pass never caught it — exactly the kind of "assumed the whole file is fine because part of it
is imported" staleness this repo's dead-code sweep exists to catch.

## Evidence

- Repo-wide grep for `MASSIVE_DOCS_BASE`/`MASSIVE_REST_BASE` across the whole repo (not just
  `src/`), before the fix: matches only their own `export const` lines in
  `src/lib/polygon-docs-nav.ts` — no import, no call, no test reference, no string reference
  anywhere else in the tree.
- `git log --all --oneline -S"MASSIVE_REST_BASE"` returns exactly the commits that (a) added the
  constant and the `/docs/polygon/*` tree that consumed it (`e7d9fe5f4`), (b) deleted that tree
  (`de9b1967f`, `965b10905`), and (c) the later unrelated #5768 cleanup/fold commits — never a
  commit adding a *new* consumer after the route deletion.
- `git show de9b1967f -- src/app/docs/polygon/rest/stocks/page.tsx` confirms the deleted page's own
  import line: `import { MASSIVE_DOCS_BASE, MASSIVE_REST_BASE } from "@/lib/polygon-docs-nav";`,
  used in `href={\`${MASSIVE_DOCS_BASE}/rest/stocks/overview\`}` and an example `GET
  ${MASSIVE_REST_BASE}/v2/aggs/...` code snippet — direct confirmation these were real, not
  speculative, consumers that simply moved to zero when the page was deleted.

## Blast radius

None beyond the file itself. `MASSIVE_WS_STOCKS`/`MASSIVE_WS_OPTIONS`/`MASSIVE_WS_INDICES` and
their three real consumers (`stocks-socket.ts`/`options-socket.ts`/`polygon-socket.ts`) are
untouched — confirmed post-fix by re-grepping their imports and by running the full `src/lib/ws/*`
test suite (187/187 green, no regressions).

## Fix rationale

Removed the unused `MASSIVE_DOCS_BASE` and `MASSIVE_REST_BASE` exports. Left the three live
`MASSIVE_WS_*` constants untouched — this fix does not repeat the prior pass's mistake of reasoning
about "the file's constants" as a group; each of the three surviving exports was individually
re-verified against its actual importing file in `src/lib/ws/`.

Also added `src/lib/polygon-docs-nav.test.ts` — this module had **no test coverage at all** before
this fix, despite feeding three live WebSocket connections. The new tests pin the three surviving
constants' values, assert the module's export surface is exactly those three (so a reintroduced
"convenience" constant with no real caller can't silently drift back in unnoticed the way these two
did), and guard that the three WS socket files never re-import the removed names.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/polygon-docs-nav.test.ts` — 3/3 green
  (new file); stashing the fix back to the pre-fix 5-constant file makes the "exports only the
  three constants" test fail (RED), confirming the test actually exercises the change.
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/polygon-docs-nav.ts src/lib/polygon-docs-nav.test.ts` — clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/ws/*.test.ts` — 187/187 green (full
  `src/lib/ws/` suite, no regressions from the three untouched live constants).
