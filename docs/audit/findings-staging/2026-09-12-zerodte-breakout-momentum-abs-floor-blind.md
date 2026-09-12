> **kind:** FINDING

## 0DTE thesis-first `momentum_abs_floor` blocks the BETTER population for BREAKOUT-origin setups — FIXED

| | |
|---|---|
| **Lane** | 0DTE "Night Hawk" — thesis-first gate stack (Ask Largo's play-brief intelligence is Swing-side; this is the 0DTE sibling: `attachThesisFirstLive`) |
| **File** | `src/lib/zerodte/board.ts` (`ZeroDteSetup.change_pct` field), `src/lib/zerodte/breakout-source.ts` (`buildBreakoutSetup`), `src/lib/zerodte/thesis/rails/legacy-bridge.ts` (`railHitsFromLegacySetup`) |
| **Status** | FIXED (this PR) |

### Evidence (already measured, pre-existing tool — see `docs/audit/0DTE-RESEARCH.md` E6)

`scripts/audit/thesis-rank-reject-outcome-ab.mjs` graded 599 real setups through the REAL
`attachThesisFirstLive` pipeline over 10 real sessions: **REJECT graded 64.3% WR (n=129) vs PASS
52.3% WR (n=470) — the gate blocks the BETTER population**, confirmed at two different entry
times (10:00 and 10:30 ET, the gap WIDENING at the second: 72.9% vs 52.4%). 115 of the 129
rejections fired on a single gate: `momentum_abs_floor` (`archetype-gates.ts`, requires
`rail_scores.MOMENTUM >= 60`, or 55 under amplify-session relief).

### Root cause

Traced to `scoreMomentumRail` (`rails/momentum.ts`) — a pure 0-100 scorer with three real levers:
`rel_vol` (up to +25), `intraday.trend_5m`/`vwap_dist_pct` (up to +12/+10), and `change_pct` (up
to +10), on a base of 40. Verified in the actual code (not assumed):

1. **`rel_vol` is always `null` for BREAKOUT-origin setups.** `railHitsFromLegacySetup` reads it
   from `setup.rel_volume`, which `enrichSetup` (`board.ts`) only ever sets from
   `dossier?.tech?.rel_volume`. `buildBreakoutSetup` (`breakout-source.ts`) explicitly calls
   `enrichSetup(base, null)` — a **null dossier**, by design (the whole-market BREAKOUT/BREAKDOWN
   screen runs over ~12k grouped-daily bars; a per-ticker technicals dossier is only fetched for
   FLOW-origin candidates that already cleared the flow evidence gates — `scan.ts`'s two
   `enrichSetup` call sites, one with a real dossier, one without). This is a deliberate,
   documented performance boundary, not a bug — reversing it would mean fetching a new,
   materially larger per-ticker technicals read for the whole-market screen population.
2. **`change_pct` was never populated for ANY origin — a separate, unconditional wiring gap.**
   `railHitsFromLegacySetup`'s call to `scoreMomentumRail` never passed a `change_pct` argument at
   all, for any discovery origin. `intraday` (5m trend / VWAP distance) IS real for every origin —
   `attachIntradayEdge` (`scan.ts`) stamps a live per-ticker minute-bar read onto every setup after
   merge, regardless of discovery origin — so that part of the rail was not the problem.

Net effect for a BREAKOUT-origin setup: the MOMENTUM rail could never exceed
`40 (base) + 12 (5m trend) + 10 (VWAP) = 62` — and only when BOTH intraday signals aligned. A real
breakout with a strong day-move but only ONE intraday alignment (the common case) scored 52
(registers a rail hit — clears `scoreMomentumRail`'s own internal 52 floor — but stays below
`archetype-gates.ts`'s separate 60 gate floor) or lower, with no way to demonstrate its own
genuine momentum through the one input a whole-market breakout screen actually measures directly:
**the day's real % move.**

### Fix

The lower-risk, more surgical option: wire the ALREADY-COMPUTED, already-fetched real day-change
into `change_pct` for BREAKOUT-origin setups specifically — not fabricate `rel_vol` (which would
need a genuinely new per-ticker historical-average-volume fetch, the larger change this repo's own
never-fabricate-an-input discipline, `docs/audit/LARGO-PRODUCT-CONTRACT.md`, argues against doing
just to clear a gate).

`screenBreakoutMovers`/`screenBreakdownMovers` (`candidates.ts`) already compute
`mover.gain = (c-o)/o` off the SAME grouped-daily bar the whole-market screen fetches — no new
provider call. `buildBreakoutSetup` now stamps `Math.abs(mover.gain) * 100` (rounded 2dp) onto a
new optional field, `ZeroDteSetup.change_pct` (`board.ts`) — `Math.abs` because
`screenBreakdownMovers` already stores `gain` as an absolute magnitude (its own doc), and
`scoreMomentumRail` only ever reads `Math.abs(change_pct)` regardless, so sign carries no
information the rail would use either way. `railHitsFromLegacySetup` now forwards
`setup.change_pct ?? null` into the `scoreMomentumRail` call — the dead parameter is now live, and
only for the origin that has a real, already-fetched value to give it; every other origin keeps
reading `undefined`/`null`, unchanged.

This raises the ceiling for a BREAKOUT-origin setup from 62 to 72 (all three levers aligned), and
— the part that matters for the 60 floor — lets a setup with only ONE intraday alignment plus a
real day-move (e.g. trend_5m aligned + an 8%+ day gain) reach 62 instead of being stuck at 52,
where before it had no way past the gate regardless of how strong the actual breakout was.

### Blast radius

- `ZeroDteSetup.change_pct` is a new **optional** field — every existing object-literal
  construction site of `ZeroDteSetup`/`EnrichedZeroDteSetup` (scan.ts, pin-source.ts, condor.ts,
  flow-corroboration.ts, and every test fixture) compiles unchanged; it defaults to
  `undefined`/`null` everywhere it isn't explicitly set.
- Only `buildBreakoutSetup` (BREAKOUT-origin construction) sets it. FLOW/PIN/CONDOR-origin setups
  are unaffected — they have no equivalent already-fetched day-change source, and none was
  fabricated for them.
- `scoreMomentumRail`'s own scoring math is untouched (the parameter already existed in its
  signature and was already correctly handled — only the caller wiring changed).
- Scope discipline: `score_floor` and every other archetype gate are untouched, per the assigned
  task's explicit scope. This fix touches only `momentum_abs_floor`'s real input for BREAKOUT
  origin.

### Fix rationale

Chosen over excluding the MOMENTUM_CONTINUATION/BREAKOUT gate for this origin (option (b) in the
task) because the missing input was genuinely, cheaply available — no larger change was needed,
so excluding the gate would have been a wider, less-justified retreat than actually feeding the
rail the real signal it was structurally starved of. `rel_vol` is left honestly `null` for this
origin rather than fabricated with a proxy — the field doc on `ZeroDteSetup.change_pct` documents
why, and a future PR that wires a real per-ticker average-volume read for BREAKOUT-origin
candidates could still legitimately add that lever later without touching this fix.

### Evidence of testing

- `src/lib/zerodte/breakout-source.test.ts` (+2 tests): `buildBreakoutSetup` populates
  `change_pct` from the mover's real day gain, and correctly uses the ABS magnitude for a
  short/breakdown mover (no accidental double sign-flip).
- `src/lib/zerodte/thesis/rails/momentum.test.ts` (new file, 4 tests): unit specs for
  `scoreMomentumRail`'s existing (never-buggy-in-isolation) `change_pct` handling — documents the
  exact 52→62 arithmetic the E6 evidence is built on, and that an extreme `change_pct` alone still
  can't manufacture a floor-clearing score (capped at +10).
- `src/lib/zerodte/thesis/rails/legacy-bridge-momentum.test.ts` (new file, 2 tests): the actual
  **wiring-level regression** — `railHitsFromLegacySetup` on a BREAKOUT-origin setup with real
  `intraday` (trend aligned) but no `rel_vol` (both real production conditions) scores 52 without
  `change_pct` and >=60 with it populated. **RED→GREEN proven**: reverting only
  `legacy-bridge.ts` (via a saved pre-fix copy, not `git stash` — this sandbox's shared stash stack
  makes a scoped file-swap the safer proof here) reproduces the exact bug (`expected >=60, got 52`
  — matching the arithmetic this fix's own comments predict); restoring the fix makes it pass
  again. `scoreMomentumRail`-level unit tests alone could NOT have caught this class of bug, since
  the function itself was never broken — only the caller's wiring was, which is why the
  wiring-level test is the one that actually regressed.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20, `/opt/node20/bin`): **13794 pass / 0 fail / 3 skipped** (pre-existing
  skips, unrelated to this change).
