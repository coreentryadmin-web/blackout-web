> **kind:** FINDING

## ops-collect-action-items.mjs's "cron never fired" P0 detector silently excludes 8 real production crons — FIXED

| | |
|---|---|
| **Area** | `scripts/railway-cron-services.mjs` (`ALL_CRON_KEYS`), consumed by `scripts/ops-collect-action-items.mjs`'s `postgresItems()` |
| **Status** | FIXED — regression test added, RED→GREEN proven via `git stash` |
| **Severity** | P1 (monitoring blind spot on 8 live production cron jobs, not a member-facing defect) |

### Root cause

`ops-collect-action-items.mjs`'s `postgresItems()` builds its "cron never fired" P0 alert
(`cron:<key>:never-fired`) entirely from `ALL_CRON_KEYS = Object.keys(CRON_SERVICE_NAMES)` in
`scripts/railway-cron-services.mjs`:

```js
const JOB_KEYS = [...ALL_CRON_KEYS];
const valuesClause = JOB_KEYS.map((_, i) => `($${i + 1})`).join(", ");
const zeroRuns = (await q(
  `SELECT j.key AS job_key FROM (VALUES ${valuesClause}) AS j(key)
   LEFT JOIN (... cron_job_runs ...) c ON c.job_key = j.key
   WHERE COALESCE(c.cnt, 0) = 0 ...`,
  JOB_KEYS
)).map((r) => r.job_key);
```

Any cron registered in `src/lib/cron-registry.ts` (the real source of truth) but absent from
`CRON_SERVICE_NAMES` is simply never asked about — if its EventBridge schedule were ever deleted
or broken (zero rows written to `cron_job_runs`, ever), this specific detector would not notice,
even though it exists precisely to catch that failure mode for every *other* cron.

`CRON_SERVICE_NAMES` is a hand-maintained map that was never updated when 8 crons were added to
`cron-registry.ts`: `banger-discovery`, `banger-live-sync`, `darkpool-discord`,
`helix-discord-digest`, `nighthawk-backfill-repair`, `thermal-discord`, `x-analytics`,
`zerodte-skip-grade`. All 8 have live `src/app/api/cron/<key>/route.ts` routes that call
`logCronRun("<key>", ...)` with exactly that `job_key` string, so they write real rows to
`cron_job_runs` in production — they are exactly the population this detector is supposed to
watch.

This is the same class of defect `cron-registry.ts`'s own `produces_member_alert` field comment
calls out by name ("Drives bie/missed-alerts.ts's outage detection — single source of truth so
that list can't silently drift from the registry (was a hand-maintained duplicate list before)")
and that `scripts/swing-cron-schedule.test.mjs`'s header documents as the exact root cause of the
2026-07-29 permanently-empty SWING board incident (swing crons registered but missing from this
same `CRON_SERVICE_NAMES` map, so they never fired in prod at all). This finding is a fresh
instance of the identical pattern, caught before a live incident rather than after one.

### Evidence

`scripts/validate-railway-cron-manifest.mjs` — a separate, pre-existing full-manifest checker for
this same registry↔service-map alignment, not wired into `npm test` — already fails on current
`origin/main`:

```
$ node scripts/validate-railway-cron-manifest.mjs
Cron manifest: registry=50 toml=51 services=42
[FAIL] registry key "banger-discovery" missing from CRON_SERVICE_NAMES
[FAIL] registry key "banger-live-sync" missing from CRON_SERVICE_NAMES
[FAIL] registry key "darkpool-discord" missing from CRON_SERVICE_NAMES
[FAIL] registry key "helix-discord-digest" missing from CRON_SERVICE_NAMES
[FAIL] registry key "nighthawk-backfill-repair" missing from CRON_SERVICE_NAMES
[FAIL] registry key "thermal-discord" missing from CRON_SERVICE_NAMES
[FAIL] registry key "x-analytics" has no railway.x-analytics.toml
[FAIL] registry key "x-analytics" missing from CRON_SERVICE_NAMES
[FAIL] registry key "zerodte-skip-grade" missing from CRON_SERVICE_NAMES
[FAIL] railway.thermal-discord-breach.toml has no CRON_JOBS registry entry
[FAIL] railway.x-intel.toml has no CRON_JOBS registry entry
[FAIL] count mismatch: registry=50 toml=51 service_map=42
```

Confirmed all 8 keys genuinely call `logCronRun` with the exact matching `job_key`:

```
$ grep -rn 'logCronRun("banger-discovery"' src/app/api/cron/banger-discovery/route.ts
93:    await logCronRun("banger-discovery", started, payload);
... (same pattern independently confirmed for the other 7 keys)
```

Added `scripts/ops-collect-cron-coverage.test.mjs`, which derives the expected key set from
`cron-registry.ts` itself (not a second hand-maintained list — the exact defect being fixed, one
level up) and asserts every registry key is present in `ALL_CRON_KEYS`. RED before the fix (8
failing assertions, one per missing key, via `git stash push -- scripts/railway-cron-services.mjs`
→ run → `git stash pop`), GREEN after (51/51 pass).

### Blast radius

Only one runtime consumer of `ALL_CRON_KEYS` exists (`grep -rn "ALL_CRON_KEYS"` across `scripts/`):
`ops-collect-action-items.mjs`'s `postgresItems()`. `CRON_SERVICE_NAMES` itself has other
(Railway-era, now-vestigial) consumers — `railway-apply-cron-config.mjs`,
`railway-audit-apply.mjs`, `railway-legacy-cron-cleanup.mjs` — all gated behind a Railway CLI that
no longer applies to production per `CLAUDE.md` ("All infrastructure runs on AWS ECS only... the
entire `blackout-staging-*`/Railway stack was decommissioned"), so this fix's live-production
effect is specifically restoring `ops-collect-action-items.mjs`'s never-fired coverage for these
8 crons.

Did **not** fix two separate, differently-rooted issues the same manifest run surfaces (left for a
future finding, different root cause each):
- `x-analytics` has no `railway.x-analytics.toml` at all — an EventBridge-provisioning gap, not a
  service-map naming gap (the fix here still adds its `CRON_SERVICE_NAMES` entry so the ops
  never-fired monitor covers it, but the underlying toml/schedule-catalog question is untouched).
- `railway.thermal-discord-breach.toml` and `railway.x-intel.toml` are orphaned TOMLs with no
  matching `cron-registry.ts` entry — the inverse direction of this bug (a TOML with no registry
  entry, vs. this fix's registry-entry-with-no-service-map-row), and a distinct question of
  whether those two crons are real/intended or stale.

### Fix rationale

Added the 8 missing keys directly to `CRON_SERVICE_NAMES` in `railway-cron-services.mjs`, reusing
the registry's own `name` field (title-cased, hyphenated) for each display name to match the
existing convention in the same map (e.g. `"nighthawk-morning-confirm": "NightHawk-Morning-
Confirm"`). Did not touch `ops-collect-action-items.mjs` itself — the bug is the source list it
reads being incomplete, not its own query logic, which is correct given a complete `JOB_KEYS`.
Did not switch the script to import `cron-registry.ts` directly (would need `tsx`/path-alias
resolution; `ops-collect-action-items.mjs` is deliberately plain-`node`-only per its own header
comment, matching `hit-cron.mjs`'s documented reason: the cron trigger path must not need the
Next.js build or `node_modules`). The regression test takes the opposite, safer approach instead:
it reads `cron-registry.ts` as text (same technique `scheduled-cron-catalog.test.mjs` and
`validate-railway-cron-manifest.mjs` already use) so the expected key set is derived, not
hand-duplicated a second time.
