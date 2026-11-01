> **kind:** FINDING

## 0DTE governor: pre-market `effective_max_concurrent` cap reduction served with no disclosure label — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live production correctness audit, `GET /api/market/zerodte/board` (authenticated,
via the shared Clerk temp-user helper `scripts/audit/lib/audit-auth-fetch.mjs`) at
`2026-11-01T14:14:17.675Z` (~09:14 ET, before the 09:30 RTH open).

**Root cause:** `src/lib/zerodte/governor.ts`'s `timeOfDaySizingFactor(etMinutes)` returns two
values that are supposed to travel together — a concurrent-cap multiplier
(`factor`/`effective_max_concurrent`) and a human-readable `label` explaining why — but derived
them from two *different*, disagreeing boundary checks:
- `label` comes from `tod.label`, i.e. `intraday.ts`'s `timeOfDayFactor(etMinutes)`, which
  correctly floors on `RTH_OPEN` (`intraday.ts:51`, `9 * 60 + 30`): `if (etMinutes < RTH_OPEN)
  return { delta: 0, label: null };` — "nothing to say, the market hasn't opened yet."
- `factor` was computed by a separate, local check with **no** `RTH_OPEN` floor at all:
  `if (etMinutes < 10 * 60) factor = 0.85;` (previously `governor.ts:332`). This fires for *any*
  pre-market instant — midnight through 9:30 ET — not just the intended 9:30–10:00 "opening chop"
  window the comment and label describe.

Net effect: during the pre-market window specifically, `summarizeGovernorForBoard()`
(`governor.ts:954-998` — **not** gated behind `GOVERNOR_ENFORCE_TOD_SIZING`, so it runs
unconditionally on every `/api/market/zerodte/board` fetch) emitted
`effective_max_concurrent: 85` and `time_of_day_sizing_factor: 0.85` (a real 15% reduction off the
real `max_concurrent: 100`) alongside `time_of_day_label: null`. The member-facing UI pill meant to
surface this (`src/features/nighthawk/components/ZeroDteBoard.tsx:604`,
`{gov.time_of_day_label && (<GovPill label="Window" ... />)}`) is gated on `time_of_day_label`
being truthy — so when `label` is null, the **entire pill is suppressed**, including its tooltip
(`title={... Effective concurrent cap ${effective_max_concurrent} (×${time_of_day_sizing_factor})
...}`) that would otherwise have surfaced exactly this number. A member looking at the board during
pre-market sees nothing unusual, while the governor is (or, once `GOVERNOR_ENFORCE_TOD_SIZING` is
ever flipped on in production, *would be*) quietly operating on a 15%-reduced concurrent-plan cap
with no stated reason anywhere in the payload or UI. Same "real effect, missing disclosure" shape
as the previously-fixed `GEX_FLIP_REASON_DISCLOSURE` key-mismatch and
`mixed_tape_blocked`-not-reflected-in-gates findings in this codebase, here in the 0DTE governor
rather than SPX Slayer.

**Evidence:** live-confirmed via authenticated `GET https://blackouttrades.com/api/market/zerodte/board`
at `2026-11-01T14:14:17.675Z` (~09:14 ET): response included
`"governor":{...,"max_concurrent":100,...,"time_of_day_label":null,"effective_max_concurrent":85,
"time_of_day_sizing_factor":0.85}` — `100 * 0.85 = 85` matches exactly, confirming the factor
branch fired pre-open while the label branch correctly stayed null.

**Fix:** added a local `RTH_OPEN_ET_MINUTES = 9 * 60 + 30` constant (mirroring `intraday.ts`'s own
un-exported `RTH_OPEN` — every caller in this lane keeps its own local copy of this boundary, see
`breakout-discovery.ts`/`pin-window.ts`/`relative-volume.ts` for the same pattern) and bounded the
"opening chop" factor branch with it: `if (etMinutes >= RTH_OPEN_ET_MINUTES && etMinutes < 10 * 60)
factor = 0.85;`. Now `factor` and `label` can never disagree about whether the market has opened —
pre-market reports an unreduced `factor: 1` / `effective_max_concurrent === max_concurrent`,
exactly matching the `label: null` it was already paired with. The 9:30-10:00 "opening chop" and
12:30-13:30 "lunch chop" reductions are otherwise unchanged (the lunch-chop branch already had no
analogous bug — it is bounded on both ends).

**Fix rationale:** the minimal, root-cause-targeted fix is to give the already-correct `label`
boundary's exact counterpart to the `factor` boundary, rather than e.g. suppressing the UI pill
differently or making the label fire during pre-market — the factor value is the thing that was
wrong (it should never silently differ from reality when there is nothing to disclose), not the
label or the UI gating, both of which already behave correctly and consistently with each other.
Deliberately left unchanged: the lunch-chop branch (`12 * 60 + 30` to `13 * 60 + 30`), which has
its own explicit lower AND upper bound and was never affected by this bug; `GOVERNOR_ENFORCE_TOD_SIZING`
(default off) and its separate, already-correctly-gated enforcement call site
(`governor.ts` ~line 749-761), which are unrelated to this display-level bug.

**Blast radius:** `timeOfDaySizingFactor` has exactly one call site besides itself/its own test
file in this lane with the enforcement flag, plus the always-on display call inside
`summarizeGovernorForBoard` (`governor.ts:970`), which is itself called from exactly one production
site (`src/lib/platform/zerodte-service.ts:836`, building the `/api/market/zerodte/board` payload's
`governor` block) and read by `ZeroDteBoard.tsx`'s disclosure pill. No other file imports or
re-derives this factor; `src/lib/zerodte/scan.ts` imports a same-named `timeOfDayFactor` but from
`intraday.ts` directly (the score-nudge, not the governor's cap multiplier) and was unaffected.
Confirmed via `grep -rln` for both symbol names across `src/`.

**Evidence (RED → GREEN):** added 2 new regression tests to `src/lib/zerodte/governor.test.ts`:
1. `timeOfDaySizingFactor: pre-market has NO cap reduction (factor/label must agree before the
   open)` — asserts `factor === 1`, `label === null`, and `effective_max_concurrent ===
   GOVERNOR_MAX_CONCURRENT_PLANS` at several pre-open instants (midnight, 8am, the live-repro
   09:14 ET, and 09:29 ET), then asserts the opening-chop reduction still correctly fires at 09:45
   ET (guards against over-correcting the fix into never firing).
2. `summarizeGovernorForBoard: pre-market board payload never shows a reduced cap with no label
   (live repro, 2026-11-01)` — reproduces the exact live payload shape at `etMinutes: 9*60+14` and
   asserts `time_of_day_label === null`, `time_of_day_sizing_factor === 1`,
   `effective_max_concurrent === max_concurrent`.

RED (pre-fix, reverting only the new `RTH_OPEN_ET_MINUTES` guard): both new tests failed —
`factor must be unreduced pre-open at 0` / `0.85 !== 1`, and the board-payload test failed the same
way (`0.85 !== 1`). GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test
governor.test.ts` → 69/69 pass. Full blast-radius sweep (`governor.test.ts`,
`zerodte-service.test.ts`, `zerodte-board-convergence.test.ts`, `zerodte-service-marks.test.ts`,
`zerodte-sim-board.test.ts`, `zerodte-ledger-pnl.test.ts`) → 125/125 pass. `npx tsc --noEmit`:
clean.
