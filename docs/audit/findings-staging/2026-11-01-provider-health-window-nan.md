> **kind:** FINDING

## `clampProviderHealthWindowMinutes` returned `NaN` on a non-numeric `PROVIDER_HEALTH_WINDOW_MIN` override, silently blacking out the provider-health monitor — FIXED

**Status:** Fixed, regression test added (`src/lib/__tests__/provider-health-reconcile.test.ts`).

### Root cause

`src/app/api/cron/provider-health-reconcile/route.ts` builds its window argument via
`Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10")` — the exact "non-numeric env
override" shape this codebase already guards explicitly elsewhere (`alert-outcome-sync`,
`nighthawk-outcomes`, `largo-cleanup` all have their own comment calling this out:
`Number("abc")` is `NaN`, which silently defeats a clamp that assumes a real number).

The shared clamp this route relies on, `clampProviderHealthWindowMinutes` in
`src/lib/provider-health-issues.ts`, had no such guard:

```ts
export function clampProviderHealthWindowMinutes(minutes: number): number {
  return Math.min(Math.max(1, Math.round(minutes)), 60);
}
```

`Math.round(NaN)` is `NaN`, and `Math.max`/`Math.min` propagate a `NaN` operand instead of
ignoring it (`Math.max(1, NaN) === NaN`), so `clampProviderHealthWindowMinutes(NaN)` returned
`NaN` — not a value in `[1, 60]` as every other input (including `0`, negative numbers, and
out-of-range values) already correctly clamped to.

### Blast radius

Both of this function's real call sites in `src/lib/provider-health-reconcile.ts` are
affected, and in two different, both-silent ways:

1. `fetchProviderTelemetryRollups` builds the SQL predicate
   `at > NOW() - ($1 || ' minutes')::interval` with `$1 = String(mins)`. With `mins = NaN`,
   that is the literal string `"NaN"`, which is not a valid Postgres interval component — the
   query throws, is caught by the function's own `try/catch`, and the cron silently returns
   zero rollups/issues on every run thereafter. The provider-health monitor — the job whose
   entire purpose is rolling up `api_telemetry_events` failures/rate-limits into admin
   incidents — goes dark with no error surfaced anywhere (`ok: true` is still returned).
2. `runProviderHealthReconcile` passes the SAME raw, unclamped `effectiveWindowMinutes` into
   `buildProviderHealthIssues(rollups, undefined, effectiveWindowMinutes)`, whose
   `windowLabel` interpolates it directly into admin-facing issue text
   (`` `the last ${windowMinutes}m window` ``) — so if this ever reached that render path with
   rollups present, an admin would read "the last NaNm window" in a live incident. This is the
   same "raw NaN surfaced to a reader" defect class already fixed elsewhere in this codebase
   (`fmt-money.ts`'s own `Number.isFinite` guards exist specifically to prevent a literal
   `$NaN` from reaching a member).

No other caller of `clampProviderHealthWindowMinutes` exists in the repo.

### Fix rationale

Added a `Number.isFinite` guard at the top of `clampProviderHealthWindowMinutes` that falls
back to a new `DEFAULT_PROVIDER_HEALTH_WINDOW_MINUTES = 10` constant — the same 10-minute
default every caller already uses when the argument is simply omitted. Fixing the shared
clamp function (rather than adding a second guard at the one `route.ts` parse site) protects
both existing call sites at once and any future caller, matching the function's own
header comment, which already states its purpose is to be the single place the query window
and the issue-text window stay in sync. Deliberately left `route.ts`'s own
`Number(... ?? "10")` parse untouched — the shared clamp is the correct, single point to make
robust, not a second copy of the same guard.

### Evidence (RED → GREEN)

Added a regression test asserting `clampProviderHealthWindowMinutes(NaN | Infinity |
-Infinity)` falls back to `10`. Confirmed RED via `git stash` on `provider-health-issues.ts`
alone: `NaN !== 10`, 1 failing assertion (8/9 other tests in the file unaffected). Restored
the fix and re-ran: 9/9 passing. `npx tsc --noEmit` clean.
