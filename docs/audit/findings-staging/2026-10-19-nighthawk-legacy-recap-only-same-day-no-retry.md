## 2026-10-19 — [FINDING, P1 Night Hawk Legacy] Same-day recap-only funnel collapse never retries — confirmed recurring twice in a row, member board empty for an entire day — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Severity:** P1 — member-facing. A recap-only Legacy edition (zero plays) serves every Night Hawk
Legacy member an empty board for the entire trading day it covers, and this is now **confirmed to
have happened twice in a row** on consecutive build nights with the identical failure signature.

**What's wrong.** `buildEveningEdition` (`src/features/nighthawk/lib/edition-builder.ts`) collapses
to a `recap_only` publish when the dossier stage returns zero scored dossiers even though discovery
found real candidates (`stage_dossiers zeroed` — every ticker's dossier fetch failed, almost always
a transient UW rate-limiter queue-congestion spike during the ~5:30pm ET build window, per the
already-documented 2026-10-16 incident in `docs/audit/MARKET-OPEN-VALIDATION.md`). Once that
recap-only row publishes, **nothing inside the same evening's edition window ever retries it**:

- `shouldRebuildStalePublishedEdition` (`edition-stale.ts`) only rebuilds a published row whose
  `published_at` predates TODAY's window (i.e. it fixes cross-day staleness after the window rolls
  over the next evening) — once today's own window has already produced a published row, this
  check is false for the rest of the night.
- The weekday cron (`src/app/api/cron/nighthawk-edition/route.ts`) re-dispatches `buildEveningEdition`
  on every tick inside the 120-minute catch-up window, but `buildEveningEdition` itself just returns
  the existing published result (`resumed: true`) without re-running anything once `job.status ===
  "published"` — confirmed in code and by the prior incident write-up ("the weekday-only cron fired
  4 more times that evening and each just confirmed the already-published empty row").
- The next *natural* rebuild only happens for the FOLLOWING day's edition — so a transient
  congestion spike that starves one night's dossier stage leaves that entire night's board empty,
  with no automatic recovery path at all.

**Evidence this is real and recurring, not a one-off.** `docs/audit/MARKET-OPEN-VALIDATION.md`
already documents the first live instance: the 2026-10-16 21:30-21:42 UTC build published
`edition_for:"2026-10-19"` recap-only with `funnel:{candidates:20,ranked:0,dossiers:0,...}` — all
20 real candidates (CRGY, AI, SNDQ, TRV, OVV, RPGL, KMI, FANG, PR, EOG, TRGP, EQT, USO, LNG, ALL,
NOC, COP, RTX, APA, EXE) hit the dossier fetch's 45s wall timeout, confirmed via CloudWatch. That
edition was never remediated (the write-up explicitly held off on an ad hoc admin-API write without
operator sign-off) and served an empty board the entire Monday 2026-10-19 session. **Fetched fresh
during this cycle (2026-10-19 22:11 UTC):** the VERY NEXT build (2026-10-19 21:41:46 UTC, publishing
`edition_for:"2026-10-20"`) hit the **identical shape** — `recap_only_reason:"No scored dossiers
after staging (20 candidate(s))."`, `funnel:{candidates:20,ranked:0,dossiers:0,synthesized:0,
critic_passed:0,published:0}`. A sibling Night Hawk Legacy audit lane independently caught the same
recurrence the same evening (`docs/audit/nighthawk-legacy-live-journal.json`, key
`legacyStarvedFunnelRecurrence_2026_10_19T2151Z`) via its own healthcheck (PR #6259, 2026-10-18,
taught the healthcheck to distinguish this starved shape from an honestly-quiet market) and
correctly reported-and-held on the ROOT CAUSE question (why dossier fetch returns null for every
single candidate — blocked on CloudWatch/replay-harness access this cycle) since that is a
live-picks-logic-adjacent diagnostic question, not a mechanical fix. **This finding and fix are
scoped narrowly to the retry-gap itself** (an operational resilience fix, not a change to any
scoring/discovery/gate decision) and are complementary to, not a substitute for, that still-open
root-cause dig.

**Fix.** Added `shouldRetryRecapOnlyEdition` (`edition-stale.ts`) and wired it into
`buildEveningEdition`'s existing "already published" branch, right alongside the pre-existing
`shouldRebuildStalePublishedEdition` cross-day check. It fires — reusing the exact same
archive-staging + job-reset code path the cross-day rebuild already uses, so no new reset logic —
only when ALL of:
- still inside today's edition window,
- the published row is `recap_only`,
- it carries real candidates (`funnel.candidates > 0`),
- `funnel.dossiers === 0` specifically (the proven total-collapse-at-staging shape — deliberately
  narrower than "any recap-only with candidates," so a recap-only caused by publish gates correctly
  blocking real scored plays, e.g. `publishGateBlockedRecapReason` where `dossiers`/`synthesized`/
  `critic_passed` are non-zero, is never re-run hoping for a different gate answer), and
- a cooldown (default 45 min, env-overridable via `NIGHTHAWK_RECAP_RETRY_COOLDOWN_MIN`) has elapsed
  since publish — comfortably longer than the ~7.6-minute UW queue-depth spike window measured for
  the 2026-10-16 incident, giving transient congestion time to clear before retrying.

**Why this shape and not an alternative.** Considered re-triggering immediately on detection instead
of waiting for a cooldown — rejected, because an immediate retry during the SAME congestion window
that caused the first failure would likely fail identically and adds load to an already-saturated
UW rate limiter. Considered firing the retry from a brand-new scheduled job (a genuinely separate
"a few hours later" retry, closer to the enhancement sketched in `MARKET-OPEN-VALIDATION.md`) —
rejected as unnecessary infrastructure: the existing weekday cron already re-dispatches
`buildEveningEdition` every ~15 minutes for the full 120-minute catch-up window, so gating on a
cooldown inside the already-existing dispatch is sufficient and adds no new moving parts. The retry
is self-rate-limiting: if it also collapses to recap-only, `published_at` re-stamps to the retry's
own publish time, so the next retry needs the full cooldown to elapse again — bounding this to
roughly one extra attempt per cooldown window, never a tight retry loop hammering a congested
upstream. Member-facing risk is near zero: `archiveAndClearNighthawkStaging` only clears the
internal scoring-scratch table, never the already-published `nighthawk_editions` row, so members
keep seeing the existing (even if empty) board throughout the retry; a retry that succeeds replaces
it with real plays, and a retry that fails again leaves the member experience unchanged from today.

**What this does NOT fix** (explicitly out of scope, left for the still-open root-cause dig): WHY
every single candidate's dossier fetch fails on these nights. The leading theory (UW rate-limiter
queue congestion during the 5:30pm ET build window, same shared-limiter contention class documented
elsewhere in this repo) is plausible and consistent with the all-or-nothing failure shape, but is
unconfirmed for the second (2026-10-19) instance specifically — no AWS/CloudWatch access this
cycle. **TONIGHT's 2026-10-20 edition is still live-broken as of this writing** (not retried yet —
the fix ships via the normal branch → PR → merge pipeline and only takes effect on a future deploy,
plus production deploys are independently stuck — see the ongoing `ecr-push-production.yml` ECS
capacity deadlock tracked on PR #4076). An ad hoc admin rebuild of tonight's specific edition
(`POST /api/admin/nighthawk/run?asOfEt=2026-10-19&persist=1`) remains a live-production write this
session is not executing unilaterally, consistent with the prior session's same call on the first
instance — raised again on PR #4076 for visibility.

**Tests.** 7 new unit tests in `edition-stale.test.ts` for `shouldRetryRecapOnlyEdition` (fires after
cooldown on a dossier-stage collapse; withholds before cooldown; never fires on a normal full
edition; never fires when publish gates blocked real scored plays; never fires with zero
candidates; never fires outside the edition window; never fires with a missing/corrupt
`published_at`). RED→GREEN proven via `git stash` on the implementation file alone (7/7 new
assertions fail with `shouldRetryRecapOnlyEdition is not a function` before the fix, 18/18 pass
after). Full `npm test` run clean (see PR).

**Files:** `src/features/nighthawk/lib/edition-stale.ts`, `src/features/nighthawk/lib/edition-stale.test.ts`,
`src/features/nighthawk/lib/edition-builder.ts`.
