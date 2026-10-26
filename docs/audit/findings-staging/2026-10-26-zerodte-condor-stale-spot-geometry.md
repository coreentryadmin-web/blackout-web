## Night Hawk 0DTE: every directional setup's calibration-only `condor` geometry (strikes/width_pct/est_win_rate) is silently derived from a STALE pre-refresh spot, with no field on the payload disclosing it is on a different clock than the setup's own (later-refreshed) `underlying_price`

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production health-check audit of `GET /api/market/zerodte/board` + `GET /api/market/zerodte/record`, 2026-10-26 |
| **Scope** | `src/lib/zerodte/board.ts` (`enrichSetup`, `EnrichedZeroDteSetup`) |

### Root cause

`board.ts`'s `enrichSetup()` builds every directional setup's calibration-only `condor` field
(`iron-condor.ts`'s `selectIronCondor`) from `const price = setup.underlying_price ?? tech?.price`,
captured at the moment `enrichSetup` runs. `enrichSetup` runs in `scan.ts` immediately after
`deriveZeroDteSetups` and **before** `scan.ts`'s `attachContractPlans` ever calls
`refreshUnderlyingFromLiveSpot` (confirmed by `qualification_underlying_price`'s own doc comment on
`EnrichedZeroDteSetup`, board.ts ~line 1717-1732, added for the analogous G-23 moneyness problem).
That refresh mutates `underlying_price`/`underlying_price_as_of` **in place** on the very same setup
object (`scan.ts` ~line 1529, `Object.assign(s, refreshed)`) for every DIRECTIONAL setup (any
`play_type !== "CONDOR"` — confirmed via `hasSingleStrikeMoneyness: s.play_type !== "CONDOR"` on the
refresh call). So by the time the board is served, `setup.underlying_price` holds the CURRENT,
live-refreshed mark, while `setup.condor`'s strikes/`width_pct`/`est_win_rate` were derived from the
EARLIER, now-stale qualification-time price — and nothing recomputed `condor` or disclosed the
mismatch. `selectIronCondor` is called exactly once per setup, inside `enrichSetup`; no later stage
in the pipeline touches `condor` again.

The payload already carries the right PATTERN to disclose this kind of staleness —
`qualification_underlying_price`/`qualification_underlying_price_as_of`, added specifically to let
G-23's moneyness gate compare "how far has price moved since qualification" — but that pair is
freely available to the *otm_pct*/gate path, not to `condor`, which carried no `as_of`/basis-price
field of its own. A consumer (a future UI surfacing this field, Largo, a health-check script, or a
member reading the raw API) who takes the setup's own displayed `underlying_price` at face value and
checks the condor width against it computes a DIFFERENT, and sometimes materially different, win-rate
than what `condor.est_win_rate` actually reports.

### Evidence

Live `GET /api/market/zerodte/board` (temp premium Clerk session, `scripts/audit/lib/prod-clerk-
session.mjs`, 2026-10-26T13:41:3x UTC): raw setup objects (TSLA/NVDA/SPY/SPXW/META/AAPL) all carry
both `underlying_price`+`underlying_price_as_of` (live) and `qualification_underlying_price`+
`qualification_underlying_price_as_of` (earlier) alongside a `condor` object with no basis field. For
every one of the 6 setups, re-deriving `call_width_pct`/`put_width_pct` from
`qualification_underlying_price` reproduces the served `condor.width_pct`/`est_win_rate`; re-deriving
from the live `underlying_price` does not (SPXW: 77% implied vs the served 92%; the other 5 landed in
the same win-rate bucket in that particular snapshot but by a narrowing margin — e.g. NVDA's tighter
width moved from 1.346% at qualification to 1.264% live, both still ≥1.0% so no bucket flip that
time, but close to the boundary).

Reproduced locally with a regression test (`src/lib/zerodte/board.test.ts`): `enrichSetup()` builds
`condor` off `underlying_price:188.2`, then the exact live mutation `attachContractPlans` performs
(`refreshUnderlyingFromLiveSpot` + `Object.assign(setup, refreshed)`) moves `underlying_price` to
`192.8` on the SAME object — before this fix, nothing on the setup recorded which price `condor` was
actually built from. Confirmed RED via `git stash` of the `board.ts` fix (test kept in place, 4
failures, all on the new assertions) before applying the fix, then GREEN after (148/148 in
`board.test.ts`).

Source: `src/lib/zerodte/board.ts` (`enrichSetup`, `const price = setup.underlying_price ?? tech?.
price`; `const condor = ... selectIronCondor({ spot: price, ... })`) and the doc comment on
`qualification_underlying_price` explicitly stating `attachContractPlans`'s
`refreshUnderlyingFromLiveSpot` mutates `underlying_price` AFTER `enrichSetup` already ran.
`src/lib/zerodte/iron-condor.ts`'s `selectIronCondor`/`estWinRateForWidth`/`CONDOR_WINRATE_BY_WIDTH`
confirm the exact bucket-lookup math used to reproduce the live discrepancy.

### Fix

Added two new optional fields to `EnrichedZeroDteSetup`, stamped in `enrichSetup` at the exact same
instant `condor` itself is built: `condor_basis_price` (the exact `price` fed into
`selectIronCondor`, never fabricated — null iff `condor` is null) and `condor_basis_as_of` (mirrors
`setup.underlying_price_as_of`, but ONLY when `price` actually came from `setup.underlying_price` —
the mutable branch that can later be refreshed; the `tech?.price` fallback carries no as-of stamp of
its own, so that case is honestly null rather than borrowing an unrelated timestamp).

This is option (b) from the health-check's two suggested directions (disclose the basis rather than
recompute at serve time), chosen over recomputing `condor` from the live-refreshed price because a
genuine recompute would also need to re-filter `key_supports`/`key_resistances`/`gex_king_strike`
against the new spot (those walls were themselves sliced relative to the OLD qualification price in
`enrichSetup`, so a stale wall list could silently feed a "live" recompute) — a second, more invasive
change to a shared helper with its own edge cases, for a field this file's own doc comment already
calls "CALIBRATION-FIRST EVIDENCE ONLY — gated by nothing, traded by nothing." Disclosure matches the
established, already-shipped pattern for the identical root cause (`qualification_underlying_price`/
`_as_of`, G-23) and gives any consumer — today's health-check script, a future UI, or Largo — exactly
what it needs to stop silently assuming `condor.est_win_rate` describes the setup's currently-
displayed spot, with no change to `condor`'s own geometry, the shared `IronCondorLegs` type used
elsewhere (`pin-discovery.ts`'s real condor_plan router), or any gate/grader.

Deliberately left unchanged: `condor` itself is not recomputed (see rationale above); `condor_plan`
(the PRICED, tradeable condor built by the flag-gated condor router for an actual `play_type:
"CONDOR"` setup) is a completely separate field built from the live chain at trade time and was never
affected by this bug.

### Regression test

`src/lib/zerodte/board.test.ts`, four new tests alongside the existing iron-condor-geometry suite:
- *"condor_basis_price/_as_of freeze the EXACT price+as-of condor was built from"*
- *"condor_basis_price survives a LATER live-spot refresh that mutates underlying_price out from
  under it"* — the direct repro: builds `condor` off one price, then applies the exact
  `refreshUnderlyingFromLiveSpot` + `Object.assign` mutation `attachContractPlans` performs in
  production, and asserts `condor_basis_price` still names the ORIGINAL price while
  `underlying_price` has moved.
- *"condor_basis_as_of is honestly null when price came from the tech fallback (no as-of to
  report)"*
- *"condor_basis_price/_as_of are null when condor itself is null"*

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/zerodte/board.test.ts` — RED pre-fix
  (144 pass / 4 fail, all four new assertions, via `git stash` of the `board.ts` fix with the test
  kept in place), GREEN post-fix (148/148).
- `npx tsx --experimental-test-module-mocks --test src/lib/zerodte/board.test.ts src/lib/zerodte/
  scan.test.ts src/lib/zerodte/gates.test.ts src/lib/zerodte/iron-condor.test.ts src/lib/zerodte/
  tier-export.test.ts src/lib/zerodte/condor.test.ts` — 481/481 pass (every `condor`/`condor_plan`
  consumer in the zerodte module).
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
