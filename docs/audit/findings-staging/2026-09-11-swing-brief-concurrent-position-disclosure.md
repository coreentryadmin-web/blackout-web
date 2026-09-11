> **kind:** FINDING

## Swing play-brief silently hides a concurrent same-ticker position — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — this cycle's assigned angle: does swing handle a ticker with multiple simultaneous positions correctly? |

### Root cause

`HorizonPlay.positionId` (`src/lib/horizon-plays.ts`) is explicitly documented as the field that
"disambiguates ticker collisions in briefs." `horizonPlayFromBangerPosition`
(`src/lib/swing/banger-lane-merge.ts`), which folds Engine B (Banger) open positions into the
Swing Command lane, never stamps it — even though the source `BangerPositionRow` carries a real
`id`. Live repro 2026-09-11 (`GET /api/market/nighthawk/horizons?view=swings`): **APPS, BAND, INSP
and TWST each had TWO concurrent, genuinely independent open Banger-engine positions on the same
ticker at once** — different strikes/expiries/entry dates/live P&L (e.g. APPS 12C entered 2026-09-08
at +28.4% vs. APPS 13C entered 2026-09-10 at ~0%).

A ticker-only `GET /api/market/swing/play-brief?playId=SWING:APPS&ticker=APPS` request — exactly
how Largo's tool-call convention resolves a plain "how's my APPS position doing" with no
strike/right hint — silently resolved via `pickLanePlayForBrief`'s best-live-P&L tiebreak
(`play-brief-resolve-pure.ts`) to ONE of the two positions and composed a full brief for it with
**zero indication a second concurrent position on the same underlying existed.** Live-fetched
response confirmed the 12C/+28.4% leg was shown; the 13C/~flat leg was invisible.

This is distinct from the #4758 fix (positionId supplied as a separate query param resolving to
the wrong CLOSED/WATCH bucket entirely) — that bug was about a caller who DID supply a positionId
getting routed to the wrong row. This one is about a caller with NO positionId to supply at all
(because Banger-origin rows never got one), where the resolver has no way to know two positions
exist and never says so.

### Evidence

Live pull of `swing/record` + `horizons?view=swings` (2026-09-11): `committed` array carried
duplicate tickers `{APPS: 2, BAND: 2, INSP: 2, TWST: 2}`, each pair confirmed as `signalKinds:
["BANGER"]`, no `positionId`, differing `contract.strike`/`entryPremium`/`committedAt`. Fetched
`play-brief?playId=SWING:APPS&ticker=APPS` live and confirmed the response's `Position` section
showed only the 12C/+28.4% leg with no mention of the 13C leg.

### Fix

Additive disclosure only — does **not** attempt to make `positionId` resolvable for Banger rows.
Wiring a positionId-based resolution branch for `banger_positions` was considered and rejected:
banger row ids and swing ledger row ids are separate DB sequences that can collide, so trusting a
banger id as a swing `positionId` hint in `resolveSwingPlayForBrief`/`loadOpenTerminalPlay` risks a
**worse** bug — silently resolving to an unrelated swing ledger position. That is out of scope for
this fix and would need its own dedicated resolution path + tests.

Instead, `siblingPositionsNote()` (new, `play-brief.ts`) uses data already on `ctx.laneRows` (no
new fetch) to find every OTHER live row sharing the resolved play's ticker (matched on
`entryPremium` differing by >0.005 — genuinely different positions on one ticker always differ in
entry price in practice) and appends an "Other concurrent position(s)" section naming each by
strike/expiry/entry date/entry price/P&L, wired into `composeSwingPlayBrief`'s OPEN-bucket path
only (WATCH/CLOSED are unaffected — a WATCH row has no live capital to concurrently confuse).

### Tests

`src/lib/swing/play-brief.test.ts`:
- `OPEN play with a same-ticker sibling live position discloses it (does not silently hide it)` —
  RED before the fix (no such section existed), GREEN after.
- `OPEN play with no same-ticker siblings omits the disclosure section` — guards against the note
  firing spuriously on the (overwhelmingly common) single-position case.

`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts`: 47/47 pass.
`tsc --noEmit`: no new errors.

### Not fixed / explicitly out of scope

- Making `positionId` a real, safe cross-table disambiguator for Banger-origin rows (needs a
  dedicated resolution path, see Fix section).
- The `resolveSwingPlayForBrief`/`loadOpenTerminalPlay` code path itself was read carefully as part
  of this investigation and is CORRECT for the case it's built for: when a `positionId` IS supplied
  (the normal swing-ledger case, not Banger), concurrent open positions on the same ticker resolve
  correctly and are isolated (filters by `r.id === positionId` before any ticker-only fallback).
