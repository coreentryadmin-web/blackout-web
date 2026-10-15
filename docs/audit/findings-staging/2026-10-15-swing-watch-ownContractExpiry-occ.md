## Ask Largo play-brief: `ownContractExpiry` can never resolve a WATCH candidate's own expiry, so the earnings-gap safety check silently never fires for pre-entry rows — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `ownContractExpiry` (`src/lib/swing/play-brief-narrative-coaching.ts`), the helper
`catalystCoaching` uses to decide whether THIS brief's own contract expires on/before an upcoming
earnings print (the `noGapExposure` branch — "this contract expires X, on/before the print, so no
earnings-gap exposure"), resolved the expiry by matching `ctx.laneRows` on ticker **+ entry
premium** (`play.entry`). That match is structurally unreachable for a WATCH candidate: a pre-entry
row has no entry premium at all (`TerminalPlay.entry` is pnl-anchor-only, populated starting at
commit — confirmed live: the real `/api/market/nighthawk/horizons?view=swings` WATCH rows carry no
`entryPremium`/`entry` field whatsoever). So for every WATCH row, `ownContractExpiry` returned
`null` unconditionally, `noGapExposure` could never evaluate true, and `catalystCoaching` always
fell through to the generic "size down or exit before report" instruction — even when the row's own
prospective contract (strike/expiry already known and rendered elsewhere in the SAME brief) would
show zero exposure.

**Evidence.** Live repro, 2026-10-15 (Ask Largo standing mandate cycle), `GET
/api/market/swing/play-brief?playId=SWING:CLS&ticker=CLS&status=WATCH`:
- The brief's own Verdict header: `**CLS 350C 9DTE**` — contract is the 2026-10-23 expiry, 350
  strike call (confirmed against the live `/api/market/nighthawk/horizons?view=swings` WATCH row,
  whose `contract` field is `{strike:350, right:"C", expiry:"2026-10-23", dte:9, ...}` with no
  `entryPremium` anywhere on the row).
- Catalysts & news section: `Earnings: **2026-10-26** in **12 days** (afterhours)`.
- Trade manager read bullet: `**Earnings in 12d** (2026-10-26 (afterhours)) — size down or exit
  before report unless thesis is earnings-driven.`

2026-10-23 (this contract's expiry) is strictly **before** 2026-10-26 (the earnings print) — this
specific prospective contract would already have expired 3 days before the print lands, i.e.
genuinely zero earnings-gap exposure — yet the brief told the member to "size down or exit before
report" for a risk that does not apply to the contract they'd actually be entering.

Git-stash RED→GREEN on the regression test added with this fix
(`src/lib/swing/play-brief-narrative-coaching.test.ts`, "catalystCoaching: WATCH candidate (no
entry premium yet) resolves expiry via occ — no gap-exposure instruction, not the generic
warning"): stashing just the `.ts` fix (not the test) and re-running
`npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief-narrative-coaching.test.ts` reproduces `174 pass / 1 fail` (the new test
fails against the asserted "expires 2026-10-23" / "no earnings-gap exposure" text, instead
rendering the generic "size down or exit before report" line); popping the stash restores
`175 pass / 0 fail`.

**Blast radius.** `ownContractExpiry` has exactly one call site (`catalystCoaching`), so the fix is
contained to that one safety-check branch. It fires for every WATCH-status swing play-brief whose
ticker has an earnings print inside the 14-day coaching window — not a rare combination; any
member glancing at a WATCH candidate's brief with upcoming earnings could be told to avoid/discount
a setup over a gap risk that doesn't actually apply to the prospective contract. Committed
(OPEN/HOLD/TRIM/CLOSED) rows were NOT silently broken — they have a real `entry` premium, so the
old laneRows match already worked for them most of the time — but the fix also strictly improves
that path: it now resolves from the row's own `occ` (an exact per-row key) instead of a
tolerance-banded entry-premium coincidence match against the full lane, removing a (currently
theoretical, not yet observed live) class of mismatch against a same-ticker sibling position whose
entry premium happens to round within the existing `0.005` tolerance.

**Fix rationale.** Every `TerminalPlay` row — WATCH or committed — already carries `occ` (an OCC
option symbol), threaded on by `adapters.ts` off that row's own `contract.expiry/right/strike`
(`occFromChainContract`) whenever no live `occ` was already known, specifically so a structured
contract identity survives past the point where `TerminalPlay.contract` is flattened to a human
label string (`"350C · 9DTE"`). `ownContractExpiry` now parses `play.occ` first via the existing,
already-tested shared `parseOccSymbol` (`src/lib/largo/core/entities.ts`, the same OCC parser the
Largo core entity-resolution layer uses elsewhere) and ticker-matches with `sameTicker` (handles
the SPX/SPXW alias correctly, same as every other cross-desk ticker join in the codebase) — falling
back to the old laneRows/entry-premium match only when no occ is present at all (a defensive
fallback for any row shape this fix didn't anticipate, not expected to fire on live data). This is
strictly additive: every existing `ownContractExpiry` test (the sibling-position disambiguation
case, the same-day premarket/afterhours/unknown-timing cases) still passes unchanged, because those
fixtures' laneRows match still succeeds identically — the occ path is only ever reached first when
it can resolve something the old path could not.

**Evidence of no regression.** `npx tsc --noEmit`: clean. Full
`play-brief-narrative-coaching.test.ts`: `175 pass / 0 fail` (173 pre-existing + 2 new). Full `npm
test` (`node scripts/run-tests.mjs`, Node 20): `16057 pass / 0 fail / 3 skipped`.
