> **kind:** `FINDING`

## Ask Largo swing brief never surfaced live execution quality (bid/ask spread) for an open position — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief.ts`, `src/features/nighthawk/command-deck/{types,adapters}.ts`) — found via the Ask Largo standing mandate's aggressive enhancement-hunting pass |
| **Severity** | P3 (genuine gap, not a correctness bug — nothing was wrong, something useful was simply never wired) |
| **PR** | fix/swing-live-spread-execution-quality |

### Root cause / gap

`contract-ranker.ts`'s entry-time contract pick is chosen by `tradability × thesisFit`, where
tradability is 40% spread tightness (`spreadPctOf`, `(ask - bid) / mid`) gated against a real,
calibrated per-sub-lane ceiling (`taxonomy.ts`'s `SWING_SUB_LANES[subLane].liquidity.maxSpreadPct`
— 18% Tactical / 25% Standard / 32% Extended). Once a position is open, that same live bid/ask is
already being fetched every tick by the active-refresh cron (`SwingLiveQuote`, `live-plays.ts`) and
already reaches `HorizonDeckSource["contract"]` (confirmed live: a real WATCH row's contract object
carries `bid`/`ask`/`mid`) — but nothing downstream ever surfaced it again. `greeksFromContract`
already extracts delta/gamma/theta/vega/iv from the identical contract object onto `TerminalPlay`
(itself a 2026-09-18 fix, FINDINGS 2026-08-06 SEV-3), and the play-brief already reads `play.greeks`
— but no analogous extraction existed for bid/ask, so a member trimming into a position had no way
to know whether they were about to sell into a tight or a blown-out book, even though the exact same
calibrated bar (`maxSpreadPct`) that picked the contract was sitting unused one file away.

This was raised as verified idea #3 in the original trader-perspective research comment on #4076
(2026-09-06: "Contract liquidity/tradability math exists and never reaches the brief") and remained
unshipped as of this cycle — confirmed via a fresh grep (`bidAskSpread|spreadPct|openInterest` across
`play-brief*.ts`/`play-brief-narrative.ts`: zero matches) before starting this fix.

### Evidence

- `contract-ranker.ts` (~line 51-52): confirmed `spreadPctOf`'s exact `(ask - bid) / mid` convention
  and the 0.4-weighted spread-tightness component of the tradability score.
- `taxonomy.ts` (~lines 269-304): confirmed `SWING_SUB_LANES[subLane].liquidity.maxSpreadPct` — a
  real, already-calibrated per-sub-lane entry liquidity gate (18%/25%/32%).
- `adapters.ts` `HorizonDeckSource["contract"]` (~line 657): confirmed `bid`/`ask`/`mid` already
  present on the same contract object `greeksFromContract` reads from.
- Live API check (`GET /api/market/nighthawk/horizons?view=swings`, MU WATCH row): confirmed a real
  row's `contract` carries `bid: 25.85, ask: 26, mid: 25.925` — the data genuinely reaches the app
  layer, not just the type definition.
- Grep sweep of `play-brief-intel.ts`/`play-brief.ts`/`play-brief-narrative.ts` for any spread/OI/
  liquidity rendering: zero matches pre-fix.

RED→GREEN proof:
- Added 5 new tests to `play-brief.test.ts` (live spread inside the sub-lane's gate; live spread
  wider than the gate; one-sided book — no fabricated spread; no live quote at all — honest
  absence; unresolvable sub-lane — bare spread line, no fabricated gate comparison).
- `git stash push -- src/features/nighthawk/command-deck/adapters.ts src/features/nighthawk/command-deck/types.ts src/lib/swing/play-brief.ts`
  (source only, kept test changes): `npx tsx --experimental-test-module-mocks --test
  src/lib/swing/play-brief.test.ts`: **84/88 pass, 4 fail** (the 4 new assertions on the new
  behavior — one of the 5 new tests, "no live quote at all", already passed pre-fix since it
  asserts an absence).
- `git stash pop`: **88/88 pass**.
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/command-deck/adapters.test.ts`:
  **148/148 pass** (no regression on the deck's own adapter suite, which `liquidityFromContract` and
  the `terminalPlayFromHorizon` wiring both touch).
- Broader sweep (`src/lib/swing/*.test.ts`): **1344/1344 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Additive only — new `DeckLiquidity` type + `liquidity` field on `TerminalPlay` (both optional,
default-absent for every existing caller/fixture that doesn't set them), a new
`liquidityFromContract` extraction function (mirrors `greeksFromContract` exactly, same file), one
new wiring line in `terminalPlayFromHorizon`, and one new conditional block in `positionSection`
(`play-brief.ts`). No existing field, section, or rendering path is touched or renamed. LEAPS shares
the same `HorizonDeckSource`/adapter path as SWING, so it gets the same live-spread line for free
once its own contracts carry a live bid/ask — 0DTE/Legacy use a different source type entirely
(`ZeroDteDeckSource`/legacy) and are unaffected.

### Fix rationale

Mirrored the existing, already-reviewed `greeksFromContract` wiring pattern exactly (same file, same
honesty-gate shape, same call site) rather than inventing a new mechanism — this codebase has now
fixed this identical "computed data never reaches the brief" shape three times (greeks, `#4101`
`unavailableSources`, and now liquidity), so reusing the proven pattern keeps the fix boring and
low-risk. Compared the live spread against the sub-lane's own **existing, calibrated**
`maxSpreadPct` gate rather than inventing a new threshold — the same bar `contract-ranker.ts`
already enforced when this exact contract was picked, so "still inside / now wider than" is a
real, defensible comparison, not an arbitrary judgment call. Three absence cases are each handled
distinctly rather than collapsed into one fallback: no live quote at all (nothing rendered), a
one-sided quote (bid/ask shown, no spread claimed), and a live spread with no resolvable sub-lane
(bare spread number, no fabricated gate comparison) — each keeps the section honest about exactly
what it does and doesn't know.

### Verification

Self-found and self-fixed this cycle (aggressive-mode enhancement hunting, not a bug report from
elsewhere): traced the gap from the original #4076 research comment through to today's source,
confirmed the underlying data genuinely reaches the app via a live API check (not just present in a
type definition), reproduced RED (84/88) → GREEN (88/88) via `git stash`, ran the deck's own adapter
suite (148/148) and the broader swing sweep (1344/1344), `tsc --noEmit` clean.
