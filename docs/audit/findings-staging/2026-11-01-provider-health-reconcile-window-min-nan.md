> **kind:** FINDING

## provider-health-reconcile's cron payload could report `window_min: NaN` even after #7125's NaN guard — FIXED

| | |
|---|---|
| **File** | `src/app/api/cron/provider-health-reconcile/route.ts`, `src/lib/provider-health-reconcile.ts` |
| **Status** | FIXED |
| **PR** | fix/provider-health-window-min |

### Root cause

`#7125` (merged) fixed `clampProviderHealthWindowMinutes` in `src/lib/provider-health-issues.ts`
to guard against a non-finite input — a misconfigured `PROVIDER_HEALTH_WINDOW_MIN` env var (e.g.
empty string or non-numeric) makes `Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10")` return
`NaN`, and without `Number.isFinite`, `Math.max`/`Math.min` propagate that `NaN` instead of
clamping it. That fix closed two consequences: the SQL interval cast throwing (silently zeroing
every rollup) and the admin-facing issue text rendering `"the last NaNm window"`.

There is a THIRD exposure point #7125 didn't reach. `runProviderHealthReconcile` (the route's only
real caller) computes `effectiveWindowMinutes = clampProviderHealthWindowMinutes(windowMinutes)`
internally and correctly threads that clamped value into both the SQL query and
`buildProviderHealthIssues`'s issue text — but it never returned that clamped value to its caller.
The cron route (`app/api/cron/provider-health-reconcile/route.ts`) built its own `window_min`
response/log field straight from the raw, un-clamped `windowMin` local variable:

```ts
const windowMin = Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10");
const { rollups, issues } = await runProviderHealthReconcile(windowMin);
...
const payload = { ok: true, window_min: windowMin, ... };
await logCronRun("provider-health-reconcile", started, payload);
```

So with a misconfigured `PROVIDER_HEALTH_WINDOW_MIN`, every REAL window usage (the SQL query, the
issue detail text) would correctly fall back to the 10-minute default — but this cron's own
`cron_job_runs` row and HTTP JSON response would still show `"window_min": NaN`, directly
contradicting the issue text an admin might be reading in the same response (e.g. `"4 fail / 30
call(s) in the last 10m window"` next to a top-level `"window_min": NaN`). This is the exact
"member/admin sees a raw NaN" defect class #7125 already fixed everywhere else this value flows —
just a third call site that fix's own scope (provider-health-issues.ts only) never reached.

### Evidence (RED → GREEN)

Added `src/lib/__tests__/provider-health-reconcile.test.ts`'s new `describe("runProviderHealthReconcile")`
block, asserting `effectiveWindowMinutes` is always finite and correctly clamped for a NaN input,
an out-of-range input, and a normal in-range input.

- **RED** (pre-fix `provider-health-reconcile.ts`/`route.ts`, isolated via `git stash`): the new
  test failed — `AssertionError: NaN input must clamp to the 10-minute default — undefined !== 10`
  (the pre-fix return type has no `effectiveWindowMinutes` field at all).
- **GREEN** (post-fix): `npx tsx --experimental-test-module-mocks --test
  src/lib/__tests__/provider-health-reconcile.test.ts` → `# pass 10, # fail 0`.
- `npx tsc --noEmit`: clean, no new type errors.

### Blast radius

`runProviderHealthReconcile` has exactly one real caller (`app/api/cron/provider-health-reconcile/
route.ts` — grepped repo-wide), so widening its return type is safe and touches no other call
site. No other file reads a `window_min` field from this route's payload.

### Fix rationale

Added `effectiveWindowMinutes` to `runProviderHealthReconcile`'s return value — the SAME clamped
number the function already computes and uses internally — rather than having the route re-derive
or re-clamp it independently (which would risk a second, drifting clamp implementation, the exact
failure shape this module's own header comment already warns against for the query-vs-issue-text
split). The route now reports that field instead of its own raw `windowMin`. Deliberately left
unchanged: `clampProviderHealthWindowMinutes` itself (already correct per #7125), the SQL query,
and the issue-text construction — only the route's own payload field changed.
