# 2026-10-31 polygon-socket.ts: indices WS URL duplicated as a hardcoded literal instead of importing `MASSIVE_WS_INDICES`

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 wiring drift / maintenance hazard (confirmed zero runtime behavior change) |

## Root cause

`src/lib/polygon-docs-nav.ts` defines four sibling constants for the Massive WebSocket/REST
endpoints:

```ts
export const MASSIVE_WS_STOCKS = "wss://socket.massive.com/stocks";
export const MASSIVE_WS_OPTIONS = "wss://socket.massive.com/options";
export const MASSIVE_WS_INDICES = "wss://socket.massive.com/indices";
```

Two of the three WS client modules correctly import and use their matching constant as the
env-var fallback default:

- `src/lib/ws/stocks-socket.ts:29` — `const STOCKS_WS_URL = process.env.STOCKS_WS_URL ?? MASSIVE_WS_STOCKS;`
- `src/lib/ws/options-socket.ts:59` — `const OPTIONS_WS_URL = process.env.OPTIONS_WS_URL ?? MASSIVE_WS_OPTIONS;`

`src/lib/ws/polygon-socket.ts` (the indices WS client — feeds `indexStore` for
`I:SPX`/`I:VIX`/`I:VIX9D`/`I:VIX3M`/`I:TICK`/`I:TRIN`/`I:ADD`) did not import `MASSIVE_WS_INDICES`
at all. Instead it duplicated the literal inline:

```ts
const POLYGON_WS_INDICES = process.env.POLYGON_WS_INDICES ?? "wss://socket.massive.com/indices";
```

This is exactly the "value duplicated as a hardcoded literal instead of wired to the shared
constant" pattern this audit lane watches for — `MASSIVE_WS_INDICES` had **zero import
references** anywhere in `src/` (confirmed via `grep -rn "MASSIVE_WS_INDICES" src`), making it
read, at first glance, like dead code to delete. Tracing the *value* (not just the symbol name)
showed its two siblings (`MASSIVE_WS_STOCKS`, `MASSIVE_WS_OPTIONS`) are both actively imported and
used by their respective WS clients — `polygon-socket.ts` is the one file in the trio that drifted,
almost certainly because it predates `polygon-docs-nav.ts`'s constants (`git log --all
-S"MASSIVE_WS_INDICES"` shows the constants file was added separately from `polygon-socket.ts`'s
own history) and was never updated to pick them up.

Why this wasn't caught earlier: both the literal and the constant resolve to the same string today,
so there is no observable behavioral bug — `npm test`/`tsc` give no signal either way. It is a
pure maintenance hazard: if `MASSIVE_WS_INDICES` is ever changed (e.g. a future Massive endpoint
migration, matching how `MASSIVE_WS_STOCKS`/`MASSIVE_WS_OPTIONS` are already centralized for
exactly that reason), two of the three WS clients would pick up the change automatically and the
third (`polygon-socket.ts`, the index feed) would silently keep pointing at the stale URL.

## Evidence

Before the fix, source-scan regression test (`src/lib/ws/polygon-socket-shared-const.test.ts`)
against unmodified `polygon-socket.ts`:

```
# tests 2
# pass 0
# fail 2
```

(fails because `polygon-socket.ts` neither imports `MASSIVE_WS_INDICES` nor references it in the
fallback expression — confirmed via `git stash` on the source file alone, test file untouched.)

After wiring the import in and replacing the literal:

```
# tests 2
# pass 2
# fail 0
```

Sibling test files re-run clean (no regressions): `polygon-socket-change-pct.test.ts` (5/5),
`polygon-index-freshness.test.ts` (1/1), `polygon-stocks-stall-gate.test.ts` (3/3),
`init-data-sockets.test.ts` (1/1), `stocks-socket.test.ts` (9/9), `leader-lock-shared.test.ts`
(4/4). `tsc --noEmit` and `eslint` clean on both touched files.

## Blast radius

Only `src/lib/ws/polygon-socket.ts` duplicated this specific literal — confirmed via
`grep -rn "socket.massive.com/indices" src` before the fix (two hits: the constant's own
definition in `polygon-docs-nav.ts`, and this one duplicate in `polygon-socket.ts`; the third hit
was a doc-comment mention in `src/app/api/market/quote/route.ts`, not a code reference, left
untouched). No other file needed the same fix.

## Fix rationale

Wired the existing shared constant in rather than deleting it as dead code — `MASSIVE_WS_INDICES`
had zero *import* references, but its *value* was live and duplicated, which is the "wire it in,
don't delete it" case this lane's methodology calls out explicitly. The change is a pure,
behavior-preserving refactor: `MASSIVE_WS_INDICES === "wss://socket.massive.com/indices"` exactly
matches the literal it replaces, so `POLYGON_WS_INDICES`'s resolved value is byte-identical before
and after. Nothing else about `polygon-socket.ts`'s indices-feed logic, leader election, or
reconnect handling was touched.
