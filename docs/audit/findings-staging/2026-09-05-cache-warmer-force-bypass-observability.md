> **kind:** FINDING

# Cache-warmer `force=1` off-hours bypasses were invisible — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | performance / observability — `desk-warm`, `heatmap-warm`, `meridian-warm`, `zerodte-warm` |

## Symptom

Standing performance-mandate CloudWatch sweep (2026-09-05, ~02:00-02:25 UTC / Fri 22:00-22:25 ET,
a weekday evening well outside the 4am-8pm ET extended-warm window) found real, non-skipped
`[cron/desk-warm] background done` completions (elapsed=10-84s each) recurring every ~60-150s —
the exact 24/7-warming shape the already-fixed `CACHE_WARM_ALWAYS` leftover-secret bug (PR #3512,
2026-09-03) produced, reproduced here even though that fix is confirmed live and complete (verified
`CACHE_WARM_ALWAYS` has zero remaining functional readers in the repo).

## Root cause

`shouldRunCacheWarmer(force, now)` correctly lets `force=1` bypass `isEtExtendedWarmHours` — that
override is intentional (legitimate on-demand/debug warms) and not itself a bug. But nothing logged
*when* a bypass happened or *which* cron it was for. Both documented in-app force=true dispatchers
(`rth-warm-leader`'s heal loop, `cron-staleness-watchdog`'s self-heal) were checked directly against
their source and both correctly re-evaluate `isEtExtendedWarmHours`/`market_hours_only` on every
invocation — no bug found in either. With zero observability into force-driven bypasses and ALB
access logging disabled (separately noted this same sweep), there is no way from CloudWatch alone to
attribute the recurring off-hours runs to a specific caller — an unmonitored script, a leftover
debug habit, or an undiscovered third dispatcher could all produce the identical symptom, and it
would stay undiagnosable the same way `CACHE_WARM_ALWAYS` was until someone hand-checked Secrets
Manager.

## Fix

`shouldRunCacheWarmer` now takes an optional `key` and logs
`[cache-warmer-gate] force=1 bypassed the hours gate for '<key>' at <iso>` via `console.info`
whenever `force` overrides an *active* hours-block (never logs when force is used redundantly
during legitimate hours, and never logs a plain unforced skip). All four call sites
(`desk-warm`/`heatmap-warm`/`meridian-warm`/`zerodte-warm`) now pass their own key. This does not
change any gating behavior — force still always runs — it makes the next off-hours saturation
incident attributable from a CloudWatch Logs grep instead of requiring a manual secrets/code audit.

## Evidence

- `src/lib/cache-warmer-gate.test.ts` — new test proves the log fires exactly once for an
  off-hours force bypass, zero times for an in-hours force call, and zero times for a plain
  unforced skip. RED (`0 !== 1`) confirmed pre-fix via `git stash`, GREEN post-fix.
- Live CloudWatch grep 2026-09-05 ~02:00-02:25 UTC: 15+ real `[cron/desk-warm] background done`
  completions in a 60-minute window, all outside the 4am-8pm ET gate, spaced ~60-150s apart
  (consistent with something re-triggering near a ~90s heal-style cadence) — the measured baseline
  this fix makes attributable going forward.

## Follow-up (not this PR)

Once this ships and the next off-hours episode logs a `key`, cross-reference against
`RTH_WRITER_HEAL_AFTER_MIN` / the actual caller to find the real trigger — candidates not yet ruled
out: the `admin/cron/run` manual endpoint, or an unmonitored health-check/validation script hitting
`?force=1` directly. Enabling ALB S3 access logging (flagged separately this sweep) would also
close this without code changes, at the cost of a small new AWS resource.
