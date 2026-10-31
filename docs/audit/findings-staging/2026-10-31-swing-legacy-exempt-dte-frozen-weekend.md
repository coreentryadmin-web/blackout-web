> **kind:** FINDING

## Legacy-carried Swing candidate serves a frozen (wrong) calendar DTE across a non-scan day — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — `GET /api/market/nighthawk/horizons?view=swings`, `GET /api/market/swing/record`, Ask Largo `get_swing_play_brief` |
| **Status** | FIXED |
| **Severity** | P2 (member/Largo-facing correctness — a served field is actively wrong, not merely stale) |

### Root cause

`src/lib/swing/legacy-confirm-promote.ts`'s `refreshCarriedLegacyPlay` recomputes a Legacy-morning-
confirm-promoted Swing candidate's `contract.dte` (and the DTE token baked into the human `reason`
string) every time it runs — but it only RUNS inside `carryLegacyPromotedIntoSnapshot`, which is
only called from `src/app/api/cron/swing-discovery/route.ts`'s own cron handler. No `swing-discovery`
scan runs on a day the market is closed (the cron is weekday-session-anchored). So once the last
real scan's carry-forward stamps `contract.dte` against ITS OWN `sessionDay`, that number rides
frozen in the persisted serving snapshot (`SWING_SERVING_CACHE_KEY`) through every subsequent serve
until the next scan happens to run — including every request made on a weekend.

This is unlike every quote field on the same carried play (mid/bid/ask/delta/gamma/theta/vega/iv),
which the 2026-10-20/2026-10-26 fixes in this same file already correctly null out once the DTE
label goes stale, because "serve Friday's last real quote as current on Saturday" is HONEST — the
market didn't move. Calendar DTE is different: it is a pure function of the calendar date and the
option's expiry alone, with no market dependency at all, so freezing it does not merely go stale —
it reports an actively WRONG number the moment a real calendar day passes, and neither of those two
prior fixes touched this field.

The serving route's per-request enrichment path (`getSwingServingLane` → `enrichPlay`, in
`src/lib/swing/serving-lane.ts`) never re-derived DTE either — it only re-stamps `setupState`/
`entryStatus`/`factors`/`regime`/etc. from the dossier, leaving `contract` (and therefore `dte`)
exactly as the persisted snapshot carried it. Every OTHER row on the same board is a real,
DB-committed position, whose `dte` is recomputed fresh on EVERY serve by `src/lib/swing/live-plays.ts`'s
`contractFromRow` (`calendarDte(etYmd(), expiry)`, using the real current ET calendar day) — so the
one Legacy-exempt, not-yet-committed candidate (`commitGateBlockedBy: ["legacy:exempt"]`, no
`positionId`) was the only row on the board whose DTE was NOT computed against today.

### Evidence

Live `GET /api/market/nighthawk/horizons?view=swings` (production), fetched twice 2026-10-31
~14:10 and ~14:18 UTC — a Saturday, market closed:

- `board.lanes.SWING` had 58 committed rows; 57 shared `contract.expiry: "2026-11-06"` and
  `contract.dte: 6`; exactly ONE outlier — **AXTI** (`commitGateBlockedBy: ["legacy:exempt"]`,
  `serving: "COMMIT_NOW"`, no `positionId`) — with the SAME `expiry` but `contract.dte: 7`, and
  `reason: "C 61 exp 2026-11-06 (7DTE, Δ—, OI 255) · Legacy morning confirm (2026-10-29)"`.
- The lane's own `scanAsOf`/`scanSessionDay` were `"2026-10-30T20:37:21.561Z"` / `"2026-10-30"`
  (Friday — the last real trading day; both fetches, 8 minutes apart, showed the same stuck value,
  confirming no scan had run since). `board.asOf` was today, 2026-10-31 (Saturday).
- `calendarDte("2026-10-30", "2026-11-06") === 7` and `calendarDte("2026-10-31", "2026-11-06") === 6`
  — exactly the two numbers observed: AXTI served the Friday-anchored number, every other row
  served today's real number.

### Fix

Added `refreshLegacyExemptDteForServe` in `src/lib/swing/serving-lane.ts`, called from `enrichPlay`
on EVERY serve (not gated on a fresh scan having run): for a play carrying
`commitGateBlockedBy: ["legacy:exempt"]`, it recomputes `contract.dte` as `calendarDte(todayEt(),
contract.expiry)` and, when that differs from the persisted value, rewrites both `contract.dte` and
the `NDTE` token inside `reason` to match. This mirrors `live-plays.ts`'s own fresh-every-serve
`calendarDte(etYmd(), expiry)` for the one path that doesn't go through that function.

Deliberately narrow: only `contract.dte` and the DTE token in `reason` move. mid/bid/ask/delta/
gamma/theta/vega/iv are left exactly as the prior fixes already left them (nulled once the last real
carry-forward found the DTE stale) — this function has no fresh quote to refresh them with, and
recomputing DTE needs no provider read, so it is safe to run unconditionally on every serve, scan or
no scan.

The new logic lives in `serving-lane.ts`, not in `legacy-confirm-promote.ts` where
`refreshCarriedLegacyPlay` itself lives — same reason `serving-lane.ts`'s existing `isLegacyExemptPlay`
helper is a local re-implementation rather than an import: `legacy-confirm-promote.ts` imports
`persistSwingServingSnapshot`/`readSwingServingSnapshot` FROM `serving-lane.ts`, so `serving-lane.ts`
cannot import back from it without a circular dependency.

### Blast radius

Only `enrichPlay`'s one call site inside `getSwingServingLane` is touched — every consumer of the
SWING serving lane (the `/horizons?view=swings` route, the Swings desk UI, and Ask Largo's
`get_swing_play_brief` tool, which — unlike the summarized `get_nighthawk_horizons` tool that strips
`contract` entirely — can surface `contract.dte`/`reason` verbatim for a specific ticker) now gets
the corrected value. A live, DB-committed position (the other 57 rows) is untouched: it never takes
the `enrichPlay` Legacy-exempt branch (no `commitGateBlockedBy`), and was already correct via
`live-plays.ts`.

### Regression test

`src/lib/swing/serving-lane.test.ts`: two new tests. The first builds a Legacy-exempt play with a
contract one calendar day stale (mirroring the live Friday-vs-Saturday repro, computed dynamically
off `todayEt()`/`calendarDte()` so it is never a hardcoded, eventually-wrong date) and asserts both
`contract.dte` and the `reason` string's DTE token are corrected to today's real value through
`getSwingServingLane`. The second asserts a non-Legacy-exempt play's `contract.dte` is left exactly
as the discovery scan produced it, to pin the fix's scope. RED→GREEN verified by reverting
`serving-lane.ts` to its pre-fix `HEAD` content (test file unchanged) — the first new test failed
(`8 !== 7`) and the second still passed, confirming the regression test actually depends on the fix;
restoring the fix made all 25 tests in the file pass again.
