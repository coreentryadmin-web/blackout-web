> **kind:** `FINDING`

## 0DTE board condor calibration-bucket widths (and option greeks) were destroyed to a flat 2dp on the wire, collapsing 77%/92%/96% win-rate buckets onto the identical served value — root cause was ONE LAYER UPSTREAM of where a prior pass fixed it — FIXED

| | |
|---|---|
| **Severity** | P2 (member-facing data-integrity/precision loss on a live product surface — Ask Largo and the Night Hawk Command board both serve a condor's calibration-bucket width as a number a member/Largo can't actually distinguish from a different, differently-calibrated geometry; no financial-math error, no wrong trade, but a real loss of the Largo-contract "precision" guarantee) |
| **Surface** | `src/lib/platform/zerodte-service.ts` — `buildZeroDteBoardPayload()`'s own internal `roundFloats({...})` call, whose output is what `publishBoardSnapshot()` caches into the shared Redis board snapshot (`BOARD_SNAPSHOT_KEY`) every reader of `getZeroDteBoardPayload()` converges on (the member board route, `/nighthawk/horizons`, the `zerodte-warm` cron, `web-boot-warm`, and the Largo/BIE composers) |
| **Status** | FIXED |

### Correction notice (read this first — staleness trap)

This finding **replaces an earlier, mis-located diagnosis from the same audit pass, same day**.
The original claim said the bug was in `src/app/api/market/zerodte/board/route.ts`'s own
`ZERODTE_BOARD_GREEKS_WIRE_DP` keyDp map (added in an earlier fix) missing
`put_width_pct`/`call_width_pct` entries. That map's *contents* were indeed incomplete, but fixing
only that map would have changed nothing on the wire — an adversarial verifier traced the actual
destructive rounding to a **different, earlier call site**: `zerodte-service.ts`'s own
`buildZeroDteBoardPayload()` calls `roundFloats({...setups: displaySetups, ledger: ...})` with **no
dp/keyDp arguments at all** (defaulting to `dp=2`, zero per-key overrides), and that call's result
is what gets published to the shared Redis snapshot **before** the board route ever runs its own
(correctly-configured, but too-late) override pass. `roundFloats()` is idempotent on an
already-rounded value — re-rounding `0.01` at 4dp is still `0.01` — so route.ts's own keyDp map,
even for the fields it already listed (delta/theta/iv/gamma/vega), was **also already a no-op in
production**: the real destructive 2dp rounding had already happened and could not be recovered
downstream. This is the exact "verify against the real current source, not a prior session's
account" trap `CLAUDE.md`'s own "staleness trap" discipline warns about, caught the same day it was
introduced rather than persisting across sessions.

### Root cause

`buildZeroDteBoardPayload()` (zerodte-service.ts, ~line 855, before this fix):

```ts
const payload = roundFloats({
  available: true,
  as_of: new Date().toISOString(),
  ...
  setups: displaySetups,
  ...
  ledger: ledgerRows.map((r) => { ... }),
  ...
}) as ZeroDteBoardPayload;
```

No `dp`/`keyDp` arguments — `roundFloats<T>(value, dp = 2, keyDp?)` defaults to a flat 2 decimal
places with **zero per-key overrides**, applied recursively to the ENTIRE payload, including:

- Every fresh-find setup's `condor: IronCondorLegs | null` (iron-condor.ts) — carrying
  `put_width_pct`/`call_width_pct` at their own internal 4dp precision (`.toFixed(4)`) — and every
  `condor_plan?: CondorPlan | null` (condor.ts), which carries the same two fields for the priced,
  tradeable CONDOR structure.
- Every setup's `plan.greeks` (plan.ts's `buildContractPlan`, never rounded upstream) and every
  ledger row's `greeks` (straight off the raw 1s live-mark store) — `delta`/`theta`/`iv`/`gamma`/
  `vega`, routinely sub-0.01 for gamma/vega on a 0DTE contract.

`CONDOR_WINRATE_BY_WIDTH` (iron-condor.ts) buckets sit as close as **0.002 apart**:
`0.006 → 77%`, `0.008 → 92%`, `0.010 → 96%`. Rounding all three to a flat 2dp collapses every one
of them onto the identical served `0.01` — a member or Largo reading the served
`condor.put_width_pct`/`call_width_pct` cannot tell a 77% geometry from a 96% one; both read `0.01`.
**Live-confirmed 2026-10-26:** SPXW's served `call_width_pct` was `0.01` on the wire while the real
value re-derived from the disclosed `condor_basis_price` was `0.00825` (the 92% bucket, not
whatever `0.01` implies).

This payload is then handed to `publishBoardSnapshot()`, which writes it to the shared Redis
snapshot (`zerodte:board:snapshot:v1`) every replica and every consumer of
`getZeroDteBoardPayload()` reads — including `board/route.ts`'s own
`roundFloats(await getZeroDteBoardPayload(), 2, ZERODTE_BOARD_GREEKS_WIRE_DP)` call, which
operates on an **already-rounded** value and can therefore never recover the lost precision no
matter how correctly its own keyDp map is configured.

### Evidence

New test in `src/lib/platform/zerodte-service.test.ts` ("setups[].condor put_width_pct/call_width_pct
keep their calibration-bucket precision instead of collapsing to a flat 2dp") exercises the REAL
`buildZeroDteBoardPayload()` (not a route-level mock of its return value) with three fresh-find
setups carrying condors at the 0.006/0.008/0.010 calibration buckets.

RED→GREEN confirmed via `git show HEAD:src/lib/platform/zerodte-service.ts` (pre-fix content
restored to the working file, tested, then the fixed content restored — never a bare `git stash`):
- **Before the fix:** 1 failure — `0.01 !== 0.006` (the 77% bucket collapsed onto the served value
  the 96% bucket also produces).
- **After the fix:** 28/28 pass in `zerodte-service.test.ts`, including all three buckets serving
  distinguishably (`0.006`, `0.008`, `0.01`).

### Blast radius

- `board/route.ts`'s own `roundFloats(...)` call (member board route,
  `GET /api/market/zerodte/board`) — fixed indirectly: it now imports the single corrected keyDp
  map from `zerodte-service.ts` instead of keeping its own separate, now-redundant copy, and keeps
  calling `roundFloats()` with it as a harmless, idempotent belt-and-suspenders guard (consistent
  with this route's existing two-layer defense for `timeline_tranches`).
- Every OTHER direct reader of `getZeroDteBoardPayload()`/`buildZeroDteBoardPayload()` that does
  **not** go through `board/route.ts`'s extra pass benefits too, since they previously received the
  SAME destructively-2dp-rounded payload with no override at all:
  `GET /api/market/nighthawk/horizons` (via `horizonBoardFromZeroDtePayload` — confirmed this
  transform does not itself carry `put_width_pct`/`call_width_pct`/`condor`, so it was unaffected
  by the condor-width half of this bug, but its `payload.upstream_ok`/`payload.session` reads and
  any future lane that threads more of the raw payload through benefit from the corrected
  greeks precision), the `zerodte-warm` cron, `web-boot-warm`, and the Largo
  (`zeroDtePlaysForLargo`) / BIE composers (`composeZeroDtePlays`/`composeTickerPlayState`).
- `GET /api/admin/zerodte/sim/board`'s sim-feed path (`zerodte-sim-board.ts`) is **not** in this
  blast radius — it's a separate, admin-gated payload source (`getSimBoardPayload()`), never routed
  through `buildZeroDteBoardPayload()`.
- No consumer was found that depends on the PRE-fix 2dp-rounded intermediate value (checked every
  caller of `buildZeroDteBoardPayload`/`getZeroDteBoardPayload`/`buildAndPublishBoard`/
  `runColdBoardBuild` — all either pass the payload straight through or re-derive their own numbers
  from other, unrounded sources), so widening precision at this one shared layer is safe.

### Fix

Moved the keyDp protection to the call site that actually matters — `buildZeroDteBoardPayload()`'s
own `roundFloats({...}, 2, ZERODTE_BOARD_WIRE_DP)` call, now exported as `ZERODTE_BOARD_WIRE_DP`
(zerodte-service.ts) so there is exactly one source of truth:

```ts
export const ZERODTE_BOARD_WIRE_DP: RoundFloatsKeyDp = {
  delta: 4,
  theta: 4,
  iv: 4,
  gamma: 6,
  vega: 6,
  put_width_pct: 4,
  call_width_pct: 4,
};
```

`board/route.ts` now imports this constant instead of keeping its own local, driftable copy, and
still calls `roundFloats(await getZeroDteBoardPayload(), 2, ZERODTE_BOARD_WIRE_DP)` — idempotent on
the already-correctly-rounded payload, kept as a defensive second pass rather than removed, per
this repo's existing two-layer pattern (same file's `timeline_tranches` reconciliation runs a
second, deliberate pass for an analogous reason).

### Fix rationale

Considered the task's other offered option — skip rounding entirely at `zerodte-service.ts`'s layer
and let `board/route.ts`'s own `roundFloats()` be the ONLY place rounding happens. Rejected: several
OTHER consumers (`nighthawk/horizons` route, `zerodte-warm` cron, `web-boot-warm`, the Largo/BIE
composers) read `getZeroDteBoardPayload()` directly and do **not** go through `board/route.ts`'s
extra pass — skipping rounding upstream would have reintroduced the original IEEE-754 money-math
noise (`7499.360000000001`-style values) for every one of them, trading one precision bug for a
different one. Keeping the round at the layer that gets cached, with the correct per-key map, fixes
every consumer at once without reopening that door.

`condor_plan` (the priced, tradeable CONDOR structure, condor.ts) was not independently added to
the test — it shares the exact same `put_width_pct`/`call_width_pct` field names as `condor`
(IronCondorLegs), and `roundFloats`'s key-matching is purely by field name (scoped to the
*immediate* key, per its own doc comment), so the same `ZERODTE_BOARD_WIRE_DP` entry protects both
without a second map.

### Tests

`src/lib/platform/zerodte-service.test.ts` (1 new test, 28/28 pass in the file). Also updated
`src/app/api/market/zerodte/board/route.test.ts`'s mock of `zerodte-service` to supply
`ZERODTE_BOARD_WIRE_DP` (the route now imports it; `mock.module()` replaces ALL named exports of a
mocked specifier, so an import the real module satisfies but a stale mock omits would silently
resolve to `undefined` and disable the route's own keyDp override in that test). Full relevant
suite: `npx tsx --experimental-test-module-mocks --test` across `src/lib/zerodte/**/*.test.ts`,
`src/app/api/market/zerodte/**/*.test.ts`, `src/lib/platform/**/*.test.ts` (126 files) — 1877/1878
pass (1 pre-existing unrelated skip), 0 fail. Full repo `npm test` — 17284/17287 pass (3 pre-existing
unrelated skips), 0 fail. `npx tsc --noEmit` clean, Node 20.
