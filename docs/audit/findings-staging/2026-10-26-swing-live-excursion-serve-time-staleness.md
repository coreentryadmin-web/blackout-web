## Swing `underlyingExcursion` (MFE/MAE) served stale relative to `liveSpot` in the same `horizons?view=swings` payload — fixed

> **kind:** `FINDING`

### Root cause

`GET /api/market/nighthawk/horizons?view=swings` serves each committed SWING position's
`underlyingExcursion.{mfePct,maePct}` and `liveSpot` on the same `HorizonPlay` object, but the two
fields were populated from two independently-cadenced sources with no reconciling timestamp:

- `underlyingExcursion` was read verbatim from the LATEST persisted `swing_position_snapshots`
  row's `running_mfe`/`running_mae` (`src/lib/swing/live-plays.ts`'s `manageObservablesFromEvent`,
  fed by `db.ts`'s `fetchLatestSwingSnapshotEvents`). That snapshot is written once per
  `swing-active-refresh` cron tick — every 15 minutes during RTH
  (`cron-registry.ts`: `schedule_label: "Every 15 min (market hours)"`, `stale_after_min: 25`) — and
  the value baked into it (`signedExcursionPct`, `src/lib/swing/manage-sync.ts`) is only as fresh as
  whatever underlying spot that ONE cron tick happened to read for that ticker.
- `liveSpot` was read from `readSwingServingSnapshot().spotsByTicker` — a Redis-cached map refreshed
  by a SEPARATE block later in the SAME cron handler (`src/app/api/cron/swing-active-refresh/route.ts`,
  "Refresh serving-snapshot spots for open tickers"), which calls `loadUnderlyingSpot(ticker)` a
  SECOND, independent time for the same position, after the main per-row management loop
  (roll-plan evaluation, ex-dividend reads, calibration, DB writes) has already run for every open
  row. `horizons/route.ts` reads this Redis snapshot directly (`snap?.spotsByTicker`) with no
  connection to the DB-sourced snapshot event used for `underlyingExcursion`.

Because `signedExcursionPct` folds the GIVEN spot into a RATCHET against the row's own
`underlying_mfe`/`underlying_mae` price columns (`src/lib/swing/manage-sync.ts:401-407`), a
position's `maePct` can read `0` ("never traded below entry") from the last tick's ratchet while
`liveSpot` — served one field over on the exact same object — is already below entry. The function
was explicitly designed to take a live `spot` precisely so a caller "counts even before the ledger
ratchet runs" (its own doc comment), but no caller besides the cron itself ever called it again with
a fresher spot — `live-plays.ts`'s `livePlayFromSwingPosition` just echoed whatever the last
snapshot event happened to carry.

This was not caught earlier because every existing test around `underlyingExcursion`
(`live-plays.test.ts`) asserted the OLD, buggy contract directly: "whatever's in the snapshot is
served verbatim" — the bug and the test encoded the same assumption.

### Evidence

Live production repro cited in the audit finding (`GET /api/market/nighthawk/horizons?view=swings`,
2026-10-26T12:18:48Z, `upstream_ok:true`):

- **MRNA (positionId 65)**, LONG, `entryTriggerUnderlyingPx` 185.5, `liveSpot` 177.29 (current =
  (177.29−185.5)/185.5 = **−4.43%**), `underlyingExcursion` `{mfePct:11.29, maePct:0}` — i.e. the API
  claimed the position had NEVER traded below entry in the SAME response where `liveSpot` says it
  currently is.
- **PANW (positionId 67)**, `entryTriggerUnderlyingPx` 377.44, `liveSpot` 382.61 (current = **+1.37%**),
  `underlyingExcursion.mfePct` only 0.91% — the live favorable move already exceeds the claimed
  all-time best.
- 2 of 2 eligible (non-Banger, real-dossier) committed positions reproduced the pattern — systemic
  for this field pair, not an isolated glitch.

Regression test added at `src/lib/swing/live-plays.test.ts` (new test: "stale snapshot maePct:0 next
to an adverse live spot — RED pre-fix, GREEN post-fix") reproduces the exact shape with clean
numbers (entry 100, ratchet never below entry, live spot 95) and was confirmed RED against the
pre-fix code via `git stash` (asserted `{mfePct:10, maePct:0}`, i.e. the stale value) and GREEN
post-fix (`{mfePct:10, maePct:-5}`). A second, pre-existing test ("running_mfe/running_mae on the
snapshot…") that encoded the old verbatim-echo contract was updated to the new, correct contract
(the served value is a live recompute, not a raw echo) rather than deleted, so the old assumption
stays visible in the diff rather than silently disappearing.

### Blast radius

Every committed SWING position (`OPEN`/`HOLD`/`TRIM`) serving through `livePlayFromSwingPosition` —
reached by:
- `GET /api/market/nighthawk/horizons?view=swings` (the member board, where the audit repro ran),
- Ask Largo's swing play-brief Management section (`src/lib/swing/play-brief.ts`'s
  `tradeManagerNarrativeSection`, which reads `play.underlyingExcursion` verbatim off the same
  `HorizonPlay`) — so the same stale value was also reaching Largo's narrated "Underlying excursion
  since entry" line, not just the raw API field.

No other consumer reads `running_mfe`/`running_mae` through a different path — `feature-store.ts`'s
trajectory studies read the DB snapshot's own `running_mfe`/`running_mae` directly for historical
analysis (correctly, since those are deliberately a point-in-time record), and are untouched by this
fix, which only changes what the LIVE serve path shows for an OPEN position right now.

### Fix rationale

Recompute at serve time instead of echoing the last snapshot verbatim: `livePlayFromSwingPosition`
now calls the SAME `signedExcursionPct` the cron uses, with the request's own `spot` (already a
parameter) and the row's own ratcheted `underlying_mfe`/`underlying_mae` PRICE columns (already
available on `SwingPositionRow`, continuously updated by the same cron — never staler than the
snapshot's own percentages). This reproduces exactly what the next cron tick would persist, without
waiting for it.

`signedExcursionPct` was extracted out of `manage-sync.ts` into a new shared module,
`src/lib/swing/underlying-excursion.ts`, so both the writer (the cron, via `manage-sync.ts`) and this
fresher reader (`live-plays.ts`) can call the identical, unchanged math. A direct `live-plays.ts` ->
`manage-sync.ts` import was avoided because `manage-sync.ts` already imports
`structuralBreakFromSpot` FROM `live-plays.ts` — pulling the shared function into its own file avoids
a circular import entirely rather than relying on it happening to work.

Scoped deliberately narrow: the live recompute only OVERRIDES the snapshot-derived excursion when a
snapshot excursion was already non-null (a real value exists to freshen) AND the live recompute
itself produced a finite result; an absent snapshot (fresh position, no cron tick has run yet) or a
missing/invalid entry price still degrades to the pre-existing honest-null behavior, per this
field's own documented "never a fabricated 0%" convention — this fix never invents a new data source
where the system deliberately showed none before, it only keeps an ALREADY-computable value fresh.

| **Status** | Fixed — see PR for exact diff. |
|---|---|
