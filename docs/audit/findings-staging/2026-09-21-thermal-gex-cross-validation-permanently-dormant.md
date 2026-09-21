# Thermal GEX cross-validation was permanently dormant during healthy RTH, contradicting its own UI copy — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/app/api/market/gex-heatmap/route.ts` (`crossValPromise`) |
| **Severity** | P2 — member-facing UI accuracy + a real cross-provider safety net that never actually ran |

### Root cause

The route fans out three independent enrichments after computing the primary Polygon-sourced
GEX matrix: overlays, Night Hawk context, and UW cross-validation (`validateGexAgainstUW`,
which compares Polygon's `call_wall`/`put_wall`/`flip` against UW's independent
`gex_strike_expiry` WS ladder — the "Cross-check" chip on the Thermal desk).

`crossValPromise` was gated on `skipSlowEnrichment` — the same flag used to skip Night Hawk
context and other genuinely expensive per-request lookups:

```ts
const skipSlowEnrichment = matrixPeek.cached && !matrixPeek.stale; // stale = age > 90s
...
const crossValPromise =
  skipSlowEnrichment || !isHeatmapPreset(ticker) || !heatmap.gex
    ? Promise.resolve(null)
    : withEnrichmentTimeout(validateGexAgainstUW(...), null);
```

But cross-validation is **not** a "slow enrichment" on this call site. `validateGexAgainstUW`
reads the UW `gex_strike_expiry` WS ladder — either an already-warm in-process `Map` (near-zero
cost) or, when the WS channel isn't fresh, returns `null` immediately. The one path with real
network cost, the UW REST fallback, is structurally unreachable here:
`restFallbackAllowed(nearTermExpiries)` in `gex-cross-validation-core.ts` is unconditionally
`false` whenever `nearTermExpiries` is supplied, and this route **always** supplies it
(`resolveNearTermExpiriesForCrossValidation(heatmap)` never returns empty for a heatmap with
any expiries). So bundling cross-validation into `skipSlowEnrichment` bought no real savings —
it just meant the check only ran once the matrix cache aged past 90s, which
`heatmap-warm` keeps from ever happening during healthy operation.

The member-facing consequence: `thermal-desk-state.ts`'s "Cross-check" chip renders `offline`
whenever `cross_validation` is absent, with tooltip copy that reads *"...Cross-check resumes
when the live strike ladder is back at the open."* That promise was false on every healthy
trading day — the chip stayed permanently off not because the second data source was actually
unavailable, but because the primary matrix was healthy enough to never trip the 90s staleness
gate that (incorrectly) doubled as the cross-validation gate.

This exact question was flagged as **"STILL UNMEASURED"** in `docs/audit/THERMAL-MAP.md` §10
item 3 (2026-08-23): *"whether the cross-check then actually runs depends on how often the
matrix exceeds 90s while heatmap-warm is active... Do not conclude either way without an RTH
probe."*

### Evidence

Live RTH probe, 2026-09-21 16:17-16:19 UTC (~11:17-11:19 ET, real trading session, real UW key):
20 reads across SPX/SPY/QQQ/IWM (5 rounds × 4 tickers, 20s apart) via `GET
/api/market/gex-heatmap?ticker=<T>`:

```
round=0 SPX cv=null calc_age_s=1.6   round=0 SPY cv=null calc_age_s=30.2
round=0 QQQ cv=null calc_age_s=4.4   round=0 IWM cv=null calc_age_s=2.1
round=1 SPX cv=null calc_age_s=9.7   round=1 SPY cv=null calc_age_s=14.7
...
round=4 IWM cv=null calc_age_s=43.8
```

`cross_validation` was `null` on all 20/20 reads; matrix age ranged 1.6-43.8s, always well
under the 90s staleness threshold that gated the check. This resolves THERMAL-MAP.md's open
question: the guard was dormant precisely when the system was healthy, exactly the failure mode
that entry warned was possible but hadn't yet confirmed.

### Blast radius

Single call site (`gex-heatmap/route.ts`'s `crossValPromise`) — no duplicated logic elsewhere.
`spx-desk.ts`'s own unscoped `getGexStrikeExpiryLadder("SPX")` call (noted as a separate open
item in FINDINGS.md, 2026-07-24 fix write-up) is unrelated: different code path, different bug
class (scope, not freshness-gating).

### Fix rationale

Removed `skipSlowEnrichment` from the `crossValPromise` condition — it now runs whenever the
ticker is a heatmap preset with a computed `gex` block, regardless of matrix cache freshness.
Left the `withEnrichmentTimeout` wrapper in place as defense-in-depth even though the REST path
is provably dead here, and left `nighthawkPromise`'s `skipSlowEnrichment` gate untouched (that
one genuinely does a DB read worth skipping on a hot cache path). No UI copy change needed: the
existing "resumes when the live strike ladder is back at the open" tooltip becomes true again
now that cross-validation is no longer blocked by an unrelated freshness gate.

### Tests

`src/app/api/market/gex-heatmap/route.test.ts`, new suite "cross-validation is not gated on
matrix freshness": (1) a FRESH cached matrix still invokes `validateGexAgainstUW` for a preset
ticker (RED pre-fix, confirmed via `git stash` on `route.ts` — 1/16 tests failed; GREEN
post-fix, 16/16 pass), (2) a STALE matrix also invokes it (no regression on the pre-existing
path), (3) a non-preset ticker still skips it (UW overlay budget guard intact). `tsc --noEmit`
and `eslint` clean on both touched files.
