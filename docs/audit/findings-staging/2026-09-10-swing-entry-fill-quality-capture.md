# Swing commit never persisted real bid/ask alongside the mid-only entry_premium

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | Night Hawk Swings — `src/lib/swing/commit.ts` |
| **Severity** | P3 (data-capture gap, not a live-trading bug) |
| **Found by** | Night Hawk Swings audit lane, v6 mandate item 4 ("does the 5-truth grader's entry premium reflect a realistic bid/ask fill or an idealized mid on illiquid names?") |

## Root cause

`buildCommitInsert`/`buildShadowInsert` (`src/lib/swing/commit.ts:541,621` pre-fix) persist
`entry_premium: isFin(c.mid) ? c.mid : null` — the raw chain mid, never a realistic bid/ask-respecting
fill. This is a **disclosed, intentional** simplification (`src/lib/swing/grade.ts`'s own header
comment, dated FINDINGS 2026-07-30), not a hidden bug — so this finding is not "fix the grader," it's
"the magnitude of the gap this creates on illiquid names was completely unmeasurable, because the
real bid/ask at commit time was never captured anywhere past that instant."

`ChainContract` (`src/lib/horizon-fanout.ts`) already carries `bid`/`ask`/`mid`, and
`src/lib/swing/contract-ranker.ts` already computes `spreadFraction = (ask-bid)/mid` as a
contract-ranking feature at selection time — the data exists at commit time, it just evaporated the
moment the ledger row was written, because nothing wrote it down.

## Evidence

A live spread-width check against the currently OPEN/HOLD/TRIM swing book (`GET
/api/market/nighthawk/horizons?view=swings`, 2026-09-10) found real `contract.bid`/`ask`/`mid` on
only 4 of 84 committed rows (the other 80 are Banger-lane merges without real `swing_positions`
contract data — the same root cause already tracked as #4700, not new). Of those 4:

```
NN:   bid 0.25 / ask 1.95 / mid 1.10  → spread = 154.5% of mid (spread WIDER than the mid itself)
NRG:  bid 6.10 / ask 7.60 / mid 6.85  → spread = 21.9% of mid
CG:   bid 5.20 / ask 6.10 / mid 5.65  → spread = 15.9% of mid
CRWD: bid 14.15 / ask 16.00 / mid 15.08 → spread = 12.3% of mid
```

NN's live spread being *wider than its own mid* is the concrete confirmation that this gap is not
merely theoretical on the current book. n=4 is too thin to build a proper reusable measurement tool
around (the same population-size blocker already logged against v6 item 2 in the durable journal),
so this cycle ships the capture fix rather than a premature statistic.

## Blast radius

Two call sites, both in `commit.ts`: `buildCommitInsert` (real committed positions) and
`buildShadowInsert` (budget/cap-blocked shadow rows — a shadowed thesis is still real signal worth
measuring the same way). Both now call a shared `fillQualityAtCommit(c)` helper.

## Fix

Added `fillQualityAtCommit(c: ChainContract)` to `commit.ts`, returning
`{ entry_bid, entry_ask, entry_mid, entry_spread_fraction }` when all three are finite and priceable,
else `null` (never fabricated). Wired into `entry_context.fill_quality` on both insert builders.
`entry_context` is the codebase's existing additive-JSONB idiom (same pattern as
`entry_context.exit`/`entry_context.executable` used elsewhere) — nothing else reads or writes over
this key, so the change is purely additive: `entry_premium` is completely unchanged, no existing
consumer of `entry_context` is affected.

## Fix rationale

The alternative — building a full audit tool today — would either measure only the 4 real positions
(meaningless at that n) or require resolving the Banger-merge question (#4700) first, which is
explicitly out of scope for this finding. The cheap, durable fix is to stop losing the data: every
future commit now carries its own real bid/ask forward, so a FUTURE tick (once the real
`swing_positions` population is large enough) can measure realized entry-fill slippage historically
without needing to have been polling live at the exact moment of each commit. This is infrastructure
for the measurement, not the measurement itself — no calibration, gate, or grading behavior changed.

## Tests

`src/lib/swing/commit.test.ts`: two new tests (fill_quality computed correctly on a priceable
contract; null, never fabricated, when bid/ask are absent) + one existing shadow-row test extended to
assert `fill_quality` is pinned on shadow rows too.

`npx tsx --experimental-test-module-mocks --test src/lib/swing/commit.test.ts`: 42/42 pass.
Full suite (Node 20): 13582 pass / 0 fail / 3 skipped. `npx tsc --noEmit`: clean.
