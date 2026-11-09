# `options-socket.ts`'s generic WS-subscription reconciler queried a table dropped 4 months ago — Legacy (and Vector) contracts were never WS-subscribed, only coincidentally covered

> **kind:** `FINDING`

### Summary
`reconcileOptionSubscriptions()` (`src/lib/ws/options-socket.ts`) is the only generic, cross-desk
feeder of the options-WS subscription pool, run every `RECONCILE_INTERVAL_MS` (30s default). Its
query — `SELECT DISTINCT ticker, expiry, option_type, strike FROM user_positions WHERE status =
'open'` — targeted a table DROPPED in `src/lib/migrations/006_drop_user_positions.sql`
(2026-07-06, "absorb 0DTE Command from Grid; remove Night's Watch") and never recreated. On every
tick since, `dbQuery` threw `42P01` (relation does not exist), reported via `captureError`, and
swallowed by this function's own try/catch as a console.warn — a permanent, silent, 30s-cadence
background failure, not a real reconcile that occasionally missed. `lastDesired` stayed the empty
`Set()` it was initialized to: this function contributed exactly ZERO contracts to the WS pool in
that entire 4+-month window.

### Root cause
Confirmed: `git log` on the migration file shows the drop landed 2026-07-06; grep of every
migration file for `user_positions` turns up only that one `DROP`. `db-transient.ts`'s
`isTransientPgError` has no match for `42P01` (undefined_table), so `dbQuery` throws after one
attempt. The ONLY other caller of `subscribeContracts`/`unsubscribeContracts` is 0DTE's own
`reconcileWsSubscriptions` (`src/lib/zerodte/live-marks.ts`), which subscribes 0DTE's own held
contracts directly — bypassing this dead reconciler entirely. Legacy (`legacy-option-marks-
server.ts`) and Vector (`vector-pick-sweep.ts`, `contract-picks/live/route.ts`) both only ever
READ the WS mark store (`getLiveOptionMarkSync`/`getLiveOptionMark`), never subscribe for their
own held/published contracts — so any WS liveness they see is coincidental overlap with 0DTE's
own (much narrower, same-day-expiry) subscription set, never anything this function provided.

This directly corrects a wrong root-cause belief already on record in
`docs/audit/nighthawk-legacy-live-journal.json` (entry `legacyMarksNoWsCoverageForUnheldPicks_
2026_10_01`), which assumed `user_positions` holds real rows reflecting genuine open positions on
other desks — the table doesn't exist at all, so that explanation was false.

### Fix
Minimal, disclosed-scope fix: `reconcileOptionSubscriptions()` is now a documented no-op — it no
longer queries the database at all. `runReconcileTick`'s other work (leadership gating via
`ensureOptionsLeadership`, `pool.watchdog`) is untouched; only the dead DB-querying body was
removed, since 0DTE's own `reconcileWsSubscriptions` self-subscribes independently and nothing
else currently has a working desired-set source. Removed the now-dead `reconcileRunning`/
`lastDesired` module state alongside it.

### Evidence
- RED: the source-scan regression test fails pre-fix (the dead `FROM user_positions` query string
  present). GREEN: post-fix, absent.
- The pre-fix call still resolved cleanly (never throws out to a caller — same as before), but
  took ~128ms (a real failed network connection attempt against a local proxy stand-in); post-fix
  it resolves in ~1ms, confirming no DB round-trip occurs anymore.
- Full `src/lib/ws/*.test.ts`: 208/208 pass. `src/lib/zerodte/live-marks.test.ts` (the one real
  consumer of the shared subscription pool): 36/36 pass, unaffected. `npx tsc --noEmit` clean.

### Blast radius
Removes a permanent, silent, 30s-cadence DB failure + `captureError` report that's been firing
since 2026-07-06. No behavior change for any live consumer: 0DTE's own self-subscription path
(`live-marks.ts`) never routed through this function, and Legacy/Vector never called
`subscribeContracts` through it either — this reconciler's output was already empty, every time,
for 4+ months.

### Deliberately NOT fixed here (disclosed follow-up)
Rebuilding a real, non-DB desired-set (e.g. Legacy's currently-published picks, Vector's held
picks, Swing's open positions pushing into an in-memory registry, mirroring how 0DTE already does
it) is a larger, separate change — `options-socket.ts` is shared infra with capacity/leader-
election constraints, so this is scoped as its own future PR rather than folded into the dead-code
removal here.

| **Status** | FIXED (partial — dead-query removal only; cross-desk desired-set rebuild disclosed as follow-up) — this PR. |
