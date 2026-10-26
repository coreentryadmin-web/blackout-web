> **kind:** `FINDING`

## Night Hawk Swings: a genuinely separate, live Banger position is silently dropped from the board when the native engine already manages the same ticker

| | |
|---|---|
| **Area** | Night Hawk Swings — board merge (`src/lib/swing/banger-lane-merge.ts`) |
| **Severity** | P1 — real, open member-capital position has zero visibility anywhere on the Swing Command board |
| **Status** | Fixed |
| **Files** | `src/lib/swing/banger-lane-merge.ts`, `src/lib/swing/banger-lane-merge.test.ts` |

### Root cause

`mergeBangerPositionsIntoSwingPlays` built `managingTickers` from every already-live NATIVE swing
play (`liveStatus` OPEN/HOLD/TRIM or `serving` MANAGING/SCALING_OUT/EXITING) and used that set to
**exclude any Engine B (Banger) play sharing that ticker from ever being added to the merged list** —
not just to protect the native row from eviction (the stated, correct intent), but to drop the
banger row outright. So once a native position existed on a ticker, every banger-origin OPEN
position on that same name was silently discarded, even when it was a genuinely different,
independently-entered position with its own contract and capital.

Live repro, found while auditing `GET /api/market/nighthawk/horizons?view=swings` for correctness
per the standing Ask Largo mandate: PANW carries a native `swing_positions` COMMIT row (`id=67`,
370-strike call, entry premium 17.70, committed 2026-10-23T16:46:15Z) **and** a separate, fully live
`banger_positions` OPEN row (`id=2103`, 400-strike call, entry premium 5.90, committed
2026-10-23T20:15:23Z — confirmed via `GET /api/market/banger/board`'s `open[]` array). Two real,
independently-sized option positions on the same underlying, opened ~3.5 hours apart by two
different engines. `GET /api/market/nighthawk/horizons?view=swings` served only `id=67` in
`board.lanes.SWING.committed[]`/`watch[]` — `id=2103` never appeared anywhere on the board — while
`GET /api/market/swing/record`'s `summary.bangerOpens` correctly counted it as one of **91** real
open Banger positions (`summary.opens: 93`, `nativeOpens: 2`). Diffing `GET
/api/market/banger/board`'s 91 open rows against the 92 `positionId`s the horizons route served
isolated the single missing row to exactly this PANW pair. Reproduced identically across two
independent live fetches (byte-identical response sizes both times), ruling out a timing race.

Two prior PRs on this exact PANW pair (#6656, 2026-10-24; #6767, 2026-10-25) treated this merge's
per-ticker drop as a given — their own write-ups call it "intentional for the lane/board views" —
and worked around its DOWNSTREAM symptom instead: #6656 stopped the play-brief resolver from
silently *substituting* the wrong row for an explicit `positionId`, and #6767 added a fallback so
the resolver can *answer* about the hidden row when asked for it directly by `positionId`. Neither
touched the drop itself, so the board itself — the exact surface a member actually looks at — still
showed only one of the two real positions. This fix addresses the root cause those two PRs scoped
around rather than re-patching a third downstream symptom.

### Fix

`mergeBangerPositionsIntoSwingPlays` no longer filters `bangerToAdd` against the native engine's
already-live tickers — every valid banger OPEN/PARTIAL row is now always added. Eviction is
unchanged in spirit but narrower in effect: it still removes a **pre-entry** native row (WATCH, or a
discovery COMMIT with no real ledger capital) on a ticker a banger row now covers, because that row
never held any capital and the banger position is simply what that thesis turned into — but it no
longer also discards the banger row when the ticket it collides with is an already-live native
position (real capital, never evicted either way).

### Blast radius

Single function. `horizonPlayFromBangerPosition`/`horizonPlayFromBangerWatch` (row → play mapping)
and the pre-entry-watch merge (`mergeBangerWatchPlays`) are untouched. Downstream, once the merged
lane carries both rows, `pickLanePlayForBrief`'s existing positionId-exact-match path (added by
#6656) now resolves `?playId=SWING:PANW:2103` directly from the lane, the same way it already
resolves any other multi-row-per-ticker case (`"two banger-origin plays on the same ticker get
distinct positionIds"` — already a tested, working scenario for Banger-vs-Banger; this fix extends
the same correctness to the native-vs-Banger case) — the #6767 DB-fallback path is unaffected and
stays as an additional safety net when discovery/the lane is unavailable that cycle.
`bookContextSection`/concentration logic was checked and already clusters same-ticker rows rather
than assuming uniqueness (PR #6628); no change needed there.

### Evidence

RED→GREEN, `git` diff stashed/restored to prove the failure was real:
- `mergeBangerPositionsIntoSwingPlays keeps BOTH the native OPEN and the banger OPEN as separate
  positions on the same ticker` — pre-fix: `1 !== 2` (banger row silently dropped). Post-fix: passes,
  both rows present with distinct `positionId`s, native row's fields untouched.
- `mergeBangerPositionsIntoSwingPlays — two independently-entered real option positions on the same
  ticker (PANW shape) both survive` — new test mirroring the exact live repro (same ticker,
  different strike/entry premium/positionId). Pre-fix: `1 !== 2`. Post-fix: passes.
- Both failures confirmed via `git checkout -- src/lib/swing/banger-lane-merge.ts` (reverting only
  the fix, keeping the new tests) → 2 failing / 26 passing; re-applying the fix → 28/28 passing.
- Full existing suite for this surface (`banger-lane-merge.test.ts`,
  `serving-lane.test.ts`, `serving-board.test.ts`, `play-brief-resolve.test.ts`) — 65/65 pass,
  including the pre-existing "replaces pre-entry row on same ticker" and "replaces discovery COMMIT
  (no ledger) with open banger" tests, which are unaffected by this change (neither scenario
  involves two already-live rows on the same ticker).
- `npx tsc --noEmit` clean.
- Full repo suite (`node scripts/run-tests.mjs`, Node 20) run alongside this change.

### RTH validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — confirm live that `GET
/api/market/nighthawk/horizons?view=swings` now shows PANW `id=2103` (or whichever ticker next has
both a native and a Banger position open simultaneously) as its own row in `committed[]`, alongside
the native row, and that `board.lanes.SWING.committedCount` plus the record route's `summary.opens`
reconcile without an unexplained gap the way they did pre-fix (92 vs 93).
