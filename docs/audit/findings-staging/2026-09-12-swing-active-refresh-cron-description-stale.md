## 2026-09-12 — `swing-active-refresh`'s registry `description` still said "Hourly" after the cadence was raised to every 15 minutes

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — `description` text corrected to match the real, already-correct `schedule_label`/`stale_after_min`. Zero behavior change (confirmed `description` has no call sites that parse/branch on it). |
| **Severity** | P3 — display/documentation-only, but flagged because leaving it wrong risks a future session "fixing" it backwards (see below). |

### What was found

Found during the Night Hawk three-engine deep audit (operator mandate, 2026-09-12), while adversarially cross-questioning a proposed swing-refresh-cadence idea. `src/lib/cron-registry.ts`'s `swing-active-refresh` entry carried a genuine internal contradiction: `schedule_label: "Every 15 min (market hours)"` and `stale_after_min: 25` sit right next to `description: "Hourly refresh of held swing positions..."` in the same object literal.

Traced the history: commit `b5765dbd6` (PR #1324, 2026-07-29) deliberately raised this cron from hourly to every 15 minutes for TACTICAL (2-7 DTE) positions ("hourly was the last open management gap" per that commit's own `FINDINGS.md` entry), correctly updating `railway.swing-active-refresh.toml`'s `cronSchedule`, the route's own header comment, and this registry's `schedule_label`/`stale_after_min` (180→25) — but missed the sibling `description` field in the same object. A plain copy/paste gap, not a deliberate choice.

Confirmed 15-minute cadence is the real, currently-deployed behavior via three independent, convergent, recent sources already on file in `docs/audit/FINDINGS.md`: a live `events.describe_rule` AWS check (2026-09-02, re-verified 2026-09-08) showing `blackout-production-swing-active-refresh` = `cron(*/15 11-21 ? * MON-FRI *)`; and live CloudWatch logs from 2026-09-11 showing the cron firing at ~15-minute spacing. By contrast, `blackout-infra`'s `terraform/modules/crons/cron-jobs.json` entry for this key (`railway_schedule: "15 13-20 * * 1-5"`, added 2026-07-28, never updated since) is stale — exactly the artifact CLAUDE.md's own "TERRAFORM STATE DOES NOT MATCH PRODUCTION" section warns is unreliable, since most cron resources are applied manually outside terraform.

Confirmed `description` is display-only: `admin-cron-health.ts` (lines ~232, ~310) passes it straight through to JSON payloads for `bie/discovery.ts`, `bie/diagnostic.ts`, and the admin dashboard — grep found zero call sites that parse or branch on its content.

### What changed

`src/lib/cron-registry.ts`'s `swing-active-refresh.description` corrected from "Hourly refresh of held swing positions..." to "Every 15 minutes during market hours, refreshes held swing positions..." (mirroring the route's own header comment). `schedule_label` and `stale_after_min` were left untouched — both are already correct.

### Why this fix, not more

The idea that surfaced this also proposed re-verifying cadence against `blackout-infra`'s `cron-jobs.json` as the source of truth — that file is confirmed stale for this specific key (last touched 2026-07-28, one day before the cadence change shipped) and citing it would have pointed a future session at the wrong number. This fix instead cites the three independent live/recent measurements already in `FINDINGS.md`. The concrete worse-case if the `description` were "corrected" the other way (matching stale `cron-jobs.json`, reverting to "Hourly" and inflating `stale_after_min` toward ~180min): the `market_hours_stale` watchdog (feeding `bie/discovery.ts`'s "LIVE-DATA WARMER SILENT DURING MARKET HOURS" alert) would silently tolerate up to ~3 hours of real silence on a live position-refresh job before ever alerting — a real regression in ops monitoring quality, not hypothetical.

**Separately flagged, not fixed here (out of scope for this single-issue PR):** the swing engine's real staleness picture is dominated by something larger than this label — a 2026-09-11 finding already on file shows `swing-active-refresh` only ever refreshes 4 real `swing_positions` rows per tick while the live Swing board serves ~73 positions (the rest are Banger-origin rows merged in for display only). That is the substantive staleness/architecture question worth chasing next, not this cosmetic text mismatch.

### Evidence

- Direct read of `src/lib/cron-registry.ts` confirming the `schedule_label`/`description` contradiction pre-fix.
- `git log`/`git show` on commit `b5765dbd6` (PR #1324) confirming the cadence change's own scope (schedule_label + stale_after_min + route/toml comments) missed `description`.
- Live AWS `events.describe_rule` history already in `docs/audit/FINDINGS.md` (2026-09-02, 2026-09-08) plus 2026-09-11 CloudWatch logs, all showing real 15-minute cadence.
- `blackout-infra/terraform/modules/crons/cron-jobs.json` checked directly and confirmed stale (unmodified since 2026-07-28) for this key.
- Grep of `admin-cron-health.ts` and its consumers (`bie/discovery.ts`, `bie/diagnostic.ts`) confirming zero call sites read `description` for anything but direct display.
- Full `npm test` (Node 20): 13829 pass / 0 fail / 3 skipped. `npx tsc --noEmit`: clean. No regression test added — a display-string correction has no meaningful behavior to assert on; `src/lib/cron-registry.test.ts`/`cron-registry-schedule.test.ts` (8 tests total) pass unmodified, confirming nothing else depends on the old wording.
