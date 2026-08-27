> **kind:** `FINDING`

## Vector Compare preset/add/rem tickers remounted every stable pane via bumpSync — lightweight-charts "Value is null" — FIXED

| Field | Detail |
|---|---|
| **Symptom** | `vector-e2e-audit.mjs` `ui:console-errors` FAIL during Compare 4-up preset load — fourteen `Value is null` errors from lightweight-charts after clicking the Indices preset. Charts still rendered; failure was console noise + redundant full teardown of working panes. |
| **Root cause** | `applyPreset`, `loadTicker`, and `removeTicker` in `VectorCompareDesk.tsx` all called `bumpSync()`, which increments `syncEpoch` folded into each linked pane's React `key`. That forces React to destroy and rebuild **every** `VectorChart` instance even when only the seed list changed — e.g. going 1-up → 4-up remounted the surviving SPX chart immediately after its first mount. Same anti-pattern already fixed for `applySyncZoomPreset` earlier the same day. |
| **Fix** | Call `flashSync()` only (visual pulse) on seed composition changes; reserve `bumpSync()` for linked lens/timeframe/DTE changes that genuinely require a coordinated remount. Updated `zerodte-bie-consistency-validator.mjs` regex (`syncLedgerLiveState(read.rows)`) — stale static guard after ledger-read refactor. |
| **Status** | FIXED |
