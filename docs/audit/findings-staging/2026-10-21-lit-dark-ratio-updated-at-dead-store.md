# SPX Slayer `lit_dark_ratio.updated_at` sourced from dead raw WS stores instead of the resolved snapshot — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

`GET /api/market/spx/desk` on production served:

```
"lit_dark_ratio":{"lit_premium":0,"dark_premium":2862377.88,"lit_share":0,"updated_at":0}
```

The same response's `dark_pool.total_premium` is `2862377.88` — byte-identical to the
`dark_premium` above — and `dark_pool.prints[0].executed_at` was `"2026-10-21T16:19:24"` against
the response's own `as_of` of `"2026-10-21T16:20:11.386Z"`: the dark-pool data feeding
`dark_premium` was genuinely ~47 seconds old, yet `updated_at` reported `0` (the Unix epoch —
"never fresh").

## Root cause

`computeLitDarkRatio()` (`src/lib/uw-lit-dark-ratio.ts`) accepts an optional caller-resolved
`DarkPoolSnapshot` and, since PR #5599 (2026-10-06), correctly sources `dark_premium`/`lit_share`
from that resolved snapshot's own freshest-print age (`resolvedAgeMs`/`resolvedFresh`) whenever the
raw `darkPoolStore` WS channel is dead (`darkPoolStore.updatedAt` stuck at its `0` default because
this ECS replica's own raw WS lane never ticked — `resolveDarkPool()` in `spx-desk.ts` has three
fallbacks, Redis-bridge cache / in-process cache / REST, precisely so the desk stays live when that
raw channel is dead).

The #5599 fix only touched the premium/share fields, though — `updated_at` was left reading:

```ts
updated_at: Math.max(litTradesStore.updatedAt, darkPoolStore.updatedAt),
```

unconditionally from the two raw store timestamps, regardless of which source(s) actually produced
the values above it. When dark freshness came from the resolved snapshot and `darkPoolStore` was
dead (the exact live scenario above), both `litTradesStore.updatedAt` and `darkPoolStore.updatedAt`
were `0`, so `Math.max(0, 0) === 0` — `updated_at` silently inverted from "genuinely ~47s old" to
"never updated," even though the function already had everything it needed (`resolvedAgeMs`) to
report the correct age. This is the exact inconsistency the function's own existing code comment
(lines 28-39) warns about for the premium/share fields, just left unfixed for the one field (`updated_at`)
that #5599 didn't touch.

**Why it wasn't caught by #5599's own regression test:** that test (`uw-lit-dark-ratio.test.ts`,
"accepts a caller-resolved dark-pool snapshot...") asserts `dark_premium`/`lit_premium`/`lit_share`
on the resolved-snapshot path but never asserted anything about `updated_at` — the one field the fix
didn't touch was also the one field nothing checked.

## Fix

`computeLitDarkRatio()` now derives `updated_at` from whichever source(s) actually contributed
fresh data to this call, instead of reading the raw stores unconditionally:

```ts
let updatedAt = 0;
if (litFresh) updatedAt = Math.max(updatedAt, litTradesStore.updatedAt);
if (darkStoreFresh) updatedAt = Math.max(updatedAt, darkPoolStore.updatedAt);
if (resolvedFresh && resolvedAgeMs != null) updatedAt = Math.max(updatedAt, now - resolvedAgeMs);
```

- `litFresh`/`darkStoreFresh` being true already guarantees (via `isWsUpdatedAtFresh`, which rejects
  `updatedAt <= 0`) that the corresponding raw store timestamp is a real, recent value — so those
  two branches are unchanged in effect from before when freshness genuinely comes from the raw
  stores.
- The new third branch derives an `updatedAt` from the resolved snapshot's own `resolvedAgeMs`
  (already computed by `latestPrintAgeMs()` a few lines above, not a new timestamp source) whenever
  dark freshness came from the caller-resolved snapshot rather than the raw store.
- The dead/unreachable "all three false" case was already excluded earlier in the function
  (`if (!litFresh && !darkFresh) return null;`), so `updatedAt` can only be `0` on a code path that
  is unreachable past that guard.

Deliberately left unchanged: the freshness gate itself (`LIT_DARK_MAX_AGE_MS`, `isWsUpdatedAtFresh`,
the `resolvedFresh`/`darkFresh` computation) — this is purely about which timestamp gets reported
once freshness has already been established, not about weakening or widening what counts as fresh.

## Evidence

Regression test added to `src/lib/uw-lit-dark-ratio.test.ts`
("`updated_at` reflects the resolved snapshot's own age, not the dead raw store (2026-10-21)")
reproduces the exact live payload shape (raw stores dead at `0`, resolved snapshot with a print
~47s old) and asserts `updated_at` tracks the resolved snapshot's own age rather than reading `0`.

RED→GREEN proof (`git stash` on the source file only, test file untouched):
- **RED** (pre-fix `uw-lit-dark-ratio.ts`): new test fails —
  `AssertionError: updated_at must not be the dead store's epoch-0 sentinel` (`expected: 0, actual: 0`,
  i.e. the assertion that it is NOT `0` fails because it IS `0`).
- **GREEN** (post-fix): all 3 tests in the file pass (`npx tsx --experimental-test-module-mocks --test
  src/lib/uw-lit-dark-ratio.test.ts` under Node 20 — `3 pass / 0 fail`).

`npx tsc --noEmit` (full project, Node 20): clean.

## Blast radius

`computeLitDarkRatio()` has exactly one definition and is called from 3 sites, all in
`src/features/spx/lib/spx-desk.ts` (lines ~1783, ~2326, ~2520) — all 3 now benefit identically since
the fix is inside the shared function itself, not duplicated per call site. No other consumer of
`computeLitDarkRatio` exists repo-wide (confirmed via repo-wide grep). `updated_at` is the only field
this change touches; `lit_premium`/`dark_premium`/`lit_share` are untouched.
