> **kind:** FINDING

## Swings `closedDeckSourcesFromChains` leaks the TERMINAL leg's cortex/budgetVerdict/laneRankAtCommit onto a worst-leg card — 7th site of an established bug class — FIXED

**Status:** FIXED (`fix/swing-closed-deck-cortex-worst-leg`)

### Root cause

`src/lib/swing/closed-plays.ts`'s `closedDeckSourcesFromChains` builds one CLOSED
deck row per resolved roll chain, using the chain-composite (worst-leg) P&L/outcome.
For a rolled chain where the worst leg isn't the terminal leg, the function
deliberately re-points `positionId`, `entryPremium`/`peakPremium`/`troughPremium`,
`contract`/`occ`/`mid`/`delta`, `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx`,
`exitAt`/`committedAt`/`firstSeenAt`, and `trimEnforcedBeforeClose` at the worst
leg's own row — six separate, heavily-documented bug-fix comments in the file
(2026-10-11 through 2026-11-01), each citing a live repro.

`cortex`, `budgetVerdict`, and `laneRankAtCommit` were never added to that
re-pointing list. They are set once in `closedDeckSourceFromRow`
(`row.entry_context?.cortex`/`.budget_verdict`/`.lane_rank_at_commit` — real
per-row JSONB columns on `swing_positions`, the same class as `entry_premium`/
`contract_delta`/`entry_underlying_px` already re-pointed) from the TERMINAL leg
only (`src = closedDeckSourceFromRow(terminal)`), and survive unconditionally via
the `...src` spread in the final `out.push({...src, ...})` — with no override.

### Evidence

Found via a five-engine live correctness audit (cycle-70). Confirmed live:
`GET /api/market/swing/record`'s only multi-leg chain in the 30-day window
(rootPositionId 44, AMZN, 2 legs) shows `exitPnlPct: -27.67` (leg 44's own loss,
correctly the worst leg per the six prior fixes) but `cortex: null` /
`budgetVerdict: null` — both are the TERMINAL leg's (48's) own `entry_context`,
not leg 44's. In this specific case leg 48 happens to carry no cortex (rolled-child
rows don't persist one), so the live symptom is a silent drop rather than a
visibly wrong narrative — but the mechanism is exactly the one that produced the
six prior "specific, checkable, false claim" bugs in this same function: the next
rolled chain where the terminal leg DOES carry its own real cortex evidence will
show that leg's Cortex veto/decision snapshot (its `as_of` timestamp, score,
supports/absent list, narrative strings) paired with a different leg's P&L,
contract, and exit reason.

Confirmed via code trace that this is reachable: `terminalPlayFromClosedSwing`
(`src/features/nighthawk/command-deck/adapters.ts:1545,1579-1581`) carries
`src.cortex`/`src.budgetVerdict`/`src.laneRankAtCommit` straight into `TerminalPlay`
for every CLOSED swing card served through this route.

Confirmed `src/lib/swing/closed-plays.test.ts` had zero test coverage for
`cortex`/`budgetVerdict`/`laneRankAtCommit` on a chain-composite row (every one of
the six already-fixed fields has dedicated tests) before this fix — i.e. this was
a genuinely un-caught gap, not an intentionally-accepted one. New regression
tests added in this PR (RED before the fix, GREEN after, proven via `git stash`/
`git stash pop`): one asserting the worst leg's own `cortex`/`budgetVerdict`/
`laneRankAtCommit` are served (not the terminal leg's), one asserting the
no-mismatch fallback when the worst leg IS the terminal leg.

Confirmed this does **not** affect Ask Largo's own per-position brief:
`loadClosedPlay` (`src/lib/swing/play-brief-resolve.ts:236-249`) explicitly avoids
the chain-composite path for exactly this reason and uses
`closedDeckSourceFromRow(target)` directly on the specific leg.

### Blast radius

Scoped to the member-facing `GET /api/market/swing/record` `closedDeck` array (via
`terminalPlayFromClosedSwing`), and any Largo tool that might read that same JSON
directly. Does not affect Ask Largo's per-position play-brief path (see above).

### Fix rationale

Borrow all three fields from `worstLegRow.entry_context` the same way every
sibling field already does, falling back to `src`'s own (terminal) value only when
the worst leg IS the terminal leg (`worstLegRow` is `null` in exactly that case) —
the identical `worstLegIsTerminal` gate every sibling field above already uses, no
new branch invented. Deliberately left unchanged: the separate SPX Slayer findings
from the same audit pass (`spx-signal-observe` direction fabrication, fixed
separately in PR #7358; the admin "Gate Block Frequency" panel always reading
`gates_blocked_json: []`, tracked separately) — different system, different root
cause.
