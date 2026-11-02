> **kind:** FINDING

## railway-audit-apply.mjs step 4 undercounts "N/M cron triggers in sync" — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`scripts/railway-audit-apply.mjs`'s step 4 ("Sync CRON_SECRET + internal base on
each cron trigger") maintained a `synced` boolean per service that started as
`true` and was flipped to `false` the moment EITHER variable needed an update:

```js
let synced = true;
if (vars.CRON_SECRET !== cronSecret) {
  setVar(serviceName, "CRON_SECRET", cronSecret);
  synced = false;
}
if (vars.CRON_TARGET_BASE_URL !== INTERNAL_CRON_BASE) {
  setVar(serviceName, "CRON_TARGET_BASE_URL", INTERNAL_CRON_BASE);
  synced = false;
}
if (synced) syncedCount += 1;
```

`syncedCount` was only incremented for services that were **already** in sync
*before* this loop ran. But `setVar` either applies the write successfully or
calls `process.exit(1)` on failure — so any service for which `setVar` was
actually called (the `synced = false` branches) is, by the time the loop moves
to the next key, now correctly in sync too. The summary line printed right
after this loop —

```js
console.log(`  ✓ ${syncedCount}/${ALL_CRON_KEYS.length} cron triggers in sync`);
```

— is the step's own self-report of whether the step did its job. By excluding
every service it had to actively fix from the numerator, it understated the
true post-apply sync count for exactly the services this step exists to
correct, while only ever crediting the ones that needed no work at all.

### Evidence

Example: 4 cron keys, 1 with no provisioned Railway service yet, and of the 3
with a service, only 1 (`GEX-Alerts`) starts already in sync; `Flow-Ingest-Cron`
needs both variables set, `Data-Correctness-Cron` needs one.

- **Old logic**: `syncedCount = 1` (only `GEX-Alerts`), even though after the
  loop runs `setVar` for the other two, all 3 existing services are in sync.
  Printed: `1/4 cron triggers in sync`.
- **Fixed logic**: `syncedCount = 3` — every service whose variables are
  brought into sync by this step (whether they needed 0, 1, or 2 updates)
  counts. Printed: `3/4 cron triggers in sync`.

New regression tests in `scripts/lib/railway-cron-var-sync.test.mjs` (5 cases)
reproduce this directly against the extracted pure function
`computeCronVarSyncPlan`. RED→GREEN proven: temporarily restoring the original
`synced`-flag gating inside that function made 3/5 tests fail, including the
exact undercount (`1 !== 3` on the mixed-batch case); the fixed version passes
all 5.

### Blast radius

Single file + its one call site: `scripts/railway-audit-apply.mjs` step 4 is
the only place this loop ran, and the extracted `computeCronVarSyncPlan` has
no other callers. No other script in the `railway-*` family (`railway-apply-
cron-config.mjs`, `railway-ops-provision.mjs`) has an equivalent counting step
— they report per-service `[patch]`/`✓ set` lines without an aggregate "N/M in
sync" summary, so they don't share this bug shape.

Note on reachability: Railway was fully decommissioned 2026-07-18 (production
now runs on AWS ECS only, per this repo's `CLAUDE.md` "Environment realities"
section), and this script's own GitHub Actions workflow
(`.github/workflows/railway-audit-apply.yml`) is marked `[DEPRECATED]`,
`workflow_dispatch`-only, with schedule/push triggers disabled. The script is
therefore not currently exercised by CI or by any live infra, but it remains
committed, non-type-checked application code with a real, demonstrable logic
bug in its own self-reporting — the same class of bug this sweep already fixed
twice in sibling files in this family (`railway-cron-services.mjs` #7355,
`railway-cron-schedule-audit.mjs` #7357).

### Fix rationale

Extracted the per-service decision (which variables need updating, and
whether the service counts toward the "in sync" summary once those updates
are applied) into a new pure, side-effect-free sibling module,
`scripts/lib/railway-cron-var-sync.mjs` — `computeCronVarSyncPlan(entries,
cronSecret, internalBase)` — following the same pattern as `scripts/lib/
cache-warm-deploy-gate.mjs`'s existing pure-logic/sibling-test split, since the
caller script performs real `railway variable set` / `railway variables
--json` network calls and has no test harness of its own.

The caller now builds a plain-data `syncEntries` array (unchanged: `getVars`
is still only called for services that actually exist in Railway, exactly as
before), passes it to `computeCronVarSyncPlan`, applies every returned update
via the existing `setVar`, and prints `syncedCount` from the function's
result — which counts a service once a plan (zero or more updates) was
produced for it, not once it originally happened to already be correct.

Left unchanged: `setVar`'s own fail-fast behavior (`process.exit(1)` on a
failed `railway variable set`, which is exactly what makes "a plan was
produced for this service" equivalent to "this service will end up in sync");
the denominator (`ALL_CRON_KEYS.length`, unchanged); and the handling of
services with no provisioned Railway trigger yet (still excluded from the
numerator via the new `missing` array, same as the old `continue`).
