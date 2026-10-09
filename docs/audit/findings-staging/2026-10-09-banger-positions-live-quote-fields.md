## 2026-10-09 — [FINDING, largo-swing] BANGER-origin committed Swing positions always served null bid/ask/greeks — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (no fabricated number — every value was honestly null — but a hardcoded absence across the large majority of the live committed book is a real product gap, not just a rare edge case) |
| **Component** | `src/lib/db.ts` (new `banger_positions` columns), `src/lib/migrations/017_banger_positions_quote_fields.sql`, `src/lib/banger/positions-db.ts` (`BangerPositionRow`, `mapBangerPositionRow`, new `updateBangerQuoteFields`), `src/app/api/cron/banger-live-sync/route.ts`, `src/lib/swing/banger-lane-merge.ts` (`horizonPlayFromBangerPosition`) |
| **PR** | fix/banger-positions-live-quote-fields |
| **Found via** | Ask Largo × Night Hawk Swings standing mandate — 14:31 UTC 5-engine live-monitor cycle, 2026-10-09; traced from a live `GET /api/market/nighthawk/horizons?view=swings` read where 91 of 92 committed SWING rows (GDDY/DKNG/CTVA and essentially the whole book) carried `contract.bid=null, ask=null, openInterest=0, delta/gamma/theta/vega/iv=null` |

### Symptom

Live production check of the Swing command board (`GET /api/market/nighthawk/horizons?view=swings`,
2026-10-09 14:3x UTC): of 92 committed SWING-lane rows, **91 served `bid:null, ask:null,
openInterest:0` and every greek null** on `contract`. Only one row (VST, a native Legacy-sourced
commit) carried a real quote. Cross-checked against `GET /api/market/swing/record`'s own summary
(`opens:91, nativeOpens:0, bangerOpens:91`) and against `GET /api/market/swing/play-brief` for three
fresh tickers (GDDY, DKNG, CTVA) — all three Banger-origin, all three showing `contract.bid/ask/
gamma/delta` null in the live brief envelope's Position/Why-this-setup sections.

### Root cause

`horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts`) — the function that maps a
`banger_positions` row (Engine B, the whole-market weekly-banger discovery+commit engine) into the
Swing lane's `HorizonPlay` — **hardcoded** `delta/gamma/theta/vega/iv: null` and `bid/ask: null,
openInterest: 0` on every single row, unconditionally, regardless of what the provider actually
quoted. This was not a data-fetch failure: `banger_positions` simply had no columns to hold this
data. Meanwhile `banger-live-sync`'s cron (`src/app/api/cron/banger-live-sync/route.ts`) **already
fetches the full option snapshot every tick** (`fetchOptionsUnifiedSnapshot`) — the exact same `snap`
object (bid/ask/OI/greeks) is already read to build a `banger_quote_tick_log` row for a research log
(`quote-tick-log.ts`), then discarded for the live position.

This is the identical SEV-2 shape FINDINGS 2026-08-06 already fixed once, on the OTHER pipe: that fix
(`src/lib/swing/live-plays.ts`'s `contractFromRow`/`liveQuoteFromEvent`) carried the native
`swing_positions` path's quote through a manage-sync snapshot so a native committed position could
show a real bid/ask/greeks instead of a hardcoded null. That fix never touched the Banger path, and
since Banger now dominates the committed book (91 of 92 rows today, 0 native), the fixed path covers
almost none of what members actually see.

### Why this matters

Banger-origin positions are not a minor lane — they are, today, essentially the entire committed
Swing book. Every one of those positions' Ask Largo play-brief ("Position" section) and the Swing
command deck's own greek/quote cells read this same hardcoded absence. A member or Largo reading
"bid: —, ask: —" on 91 of 92 live holdings cannot tell "the market genuinely has no quote for this
contract right now" from "this lane structurally never serves one" — and per
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle, an absence that is actually a wiring gap
rather than a genuine data fact should not look identical to one.

### Blast radius

- `src/lib/db.ts` — 8 new `ALTER TABLE banger_positions ADD COLUMN IF NOT EXISTS ...` statements
  (inline `runMigrations()`, mirrored in the new numbered migration file per repo convention).
- `src/lib/migrations/017_banger_positions_quote_fields.sql` — new file, documentation mirror only.
- `src/lib/banger/positions-db.ts` — `BangerPositionRow` type gains 8 nullable fields
  (`bid`/`ask`/`open_interest`/`quote_delta`/`quote_gamma`/`quote_theta`/`quote_vega`/`quote_iv`);
  `mapBangerPositionRow` reads them (via `SELECT *`, so every existing call site that already reads
  through this mapper gets the new fields automatically, no query changes needed); new
  `updateBangerQuoteFields(id, quote)` best-effort write function, same fire-and-forget discipline
  as `persistBangerQuoteTick`.
- `src/app/api/cron/banger-live-sync/route.ts` — the `fetchMarks` closure now also calls
  `updateBangerQuoteFields` per OCC, reusing the SAME snapshot already fetched (zero additional
  Polygon calls). An `occToId` map (built inside `fetchOpenPositions`, read inside `fetchMarks`) lets
  this identify which position row an OCC belongs to WITHOUT changing `live-sync.ts`'s typed
  `Map<occ, mark>` contract — the scale-out decision engine (`deriveScaleOutAction`, `updateLiveState`,
  `runBangerLiveSync`) is completely untouched; this is purely additive carriage running alongside it.
- `src/lib/swing/banger-lane-merge.ts` — `horizonPlayFromBangerPosition`'s `contract` block now reads
  `row.bid/ask/open_interest/quote_*` instead of hardcoded literals. `horizonPlayFromBangerWatch`
  (the pre-entry WATCH path, which already carried real bid/ask from discovery-time chain picks) is
  untouched — it was never part of this gap.

### Fix rationale

Chose **purely additive DB carriage** (new columns + a new best-effort write function called
alongside the existing decision path, never inside it) over threading a new field through
`live-sync.ts`'s typed `BangerLiveSyncDeps.fetchMarks: (occs) => Promise<Map<string, number>>`
contract. Changing that signature would touch the real money-moving scale-out decision engine
(`deriveScaleOutAction`, `settleExpiredBangerRow`, every call site and test of `fetchMarks`) for a
feature that is evidence/display only — unnecessary risk for a panel-data fix. The `occToId` map
approach keeps the decision engine's input/output types byte-identical while still reusing the
already-fetched snapshot with zero new network calls. Greeks columns are named `quote_*` (not bare
`delta`/`gamma`/...) to avoid any ambiguity with other business fields on the same wide table.
Deliberately left unchanged: `horizonPlayFromBangerWatch` (already correct), the scale-out decision
logic (reads only `mark`, never these new fields), and `banger_quote_tick_log` (a separate, already-
correct research-log write path that this fix does not touch or duplicate).

### Regression guard

RED→GREEN proof via `git stash` (reverted `banger-lane-merge.ts` only, kept the new tests): 1/19 then
failing in `banger-lane-merge.test.ts` (`horizonPlayFromBangerPosition serves real bid/ask/OI/greeks
when the row carries a quote`), 18/19 passing. Restored the fix: 26/26 pass across
`positions-db.test.ts` + `banger-lane-merge.test.ts`. Added: one `mapBangerPositionRow` round-trip
test (null-default + real-value cases) in `positions-db.test.ts`; two `horizonPlayFromBangerPosition`
tests in `banger-lane-merge.test.ts` (real quote surfaces; absence stays honest null, never
fabricated).

### Gates

Full suite green in an isolated worktree off `origin/main` (Node 20, `--experimental-test-module-
mocks`): **15898 pass / 0 fail / 3 skipped** (`npm test`). `npx tsc --noEmit` clean.
