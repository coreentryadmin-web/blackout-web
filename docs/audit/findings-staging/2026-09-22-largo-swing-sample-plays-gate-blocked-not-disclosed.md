> **kind:** FINDING

# `get_nighthawk_horizons`'s `sample_plays` didn't disclose gate-blocked / no-real-position, even though the aggregate count already does

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P3 (Ask Largo product-contract correctness — no capital/gating logic changed) |
| **Surface** | Night Hawk Swings — Largo tool `get_nighthawk_horizons` |
| **File** | `src/lib/largo/product-reads.ts` (`compactSwingLane`) |

## Root cause

`compactSwingLane`'s `sample_plays` field maps the first 8 of `[...lane.committed, ...lane.watch]`
to `{ticker, status, direction, horizon, score, reason}` — nothing else. For SWING, `status: "COMMIT"`
means only "score cleared the commit floor" (`serving.ts`'s `aboveFloor` gate), stamped on a candidate
the moment discovery scores it, long before the real-time commit gates (`commit.ts`'s G-S3/G-S4/G-S6/
G-S12/G-S14) or any real capital move. A play can carry `status: "COMMIT"` while its own
`commitGateBlockedBy` array is non-empty (real gates currently blocking it) and no `positionId` at
all (never reached the ledger) — this codebase already has a name for that population: "floor-cleared
candidate, no position yet," distinct from a genuinely open position.

This exact ambiguity was already found and partially fixed at the AGGREGATE level on 2026-09-08
(`committed_count` vs `open_position_count`, see `product-reads-swing-open-count.test.ts`) — but the
fix only touched the summary counters. `sample_plays`, the per-row list a member's actual question
("what's committed in swings right now", "what names are you watching") is most likely to surface
through, kept the exact same unqualified shape the aggregate fix was built to stop members from
being misled by.

## Evidence

Live-pulled `GET /api/market/nighthawk/horizons?view=swings` on 2026-09-22 (pre-market): SWING lane
carried 83 `status: "COMMIT"` rows. Only 1 is a real, native `swing_positions` ledger row (AAPL,
`positionId: 40`); 80 are Banger-lane merges (real Banger ledger rows, `regime: "BREAKOUT · BANGER"`);
the remaining 2 — **AMD** and **META**, both landing in the first 8 of `[...committed, ...watch]` and
therefore inside `sample_plays`' slice — have `positionId: undefined` and real, populated
`commitGateBlockedBy`:

```
AMD:  commitGateBlockedBy: ["gate:G-S12:halt_feed_stale", "gate:G-S6:confluence", "gate:G-S14:cortex_veto:gex-walls"]
META: commitGateBlockedBy: ["gate:G-S12:halt_feed_stale", "gate:G-S14:cortex_veto:gex-walls"]
```

Both would sample into `get_nighthawk_horizons`'s payload with `status: "COMMIT"` and no caveat —
indistinguishable, from the model's point of view, from a genuinely open, unblocked position sampled
alongside them.

Traced the member-facing entry-action pill (`entry-verdict.ts`'s `swingEntryVerdict`, consumed by
`terminalPlayFromHorizon` in `adapters.ts`) and confirmed it is NOT affected by this gap — it always
re-resolves `commitGateBlockedBy` independently and correctly renders `WAIT` with the real gate reason
for both names, never `COMMIT`. The dead/unmounted `HorizonLaneBoard.tsx` component (zero render call
sites anywhere in `src/app` or `src/features`, confirmed by grep) does read the same raw
`lane.committed` field unguarded, but since nothing renders it today there is no live UI exposure —
`get_nighthawk_horizons` (a real, registered Largo tool, dispatched in `run-tool.ts`) is the one live
surface this gap actually reaches a member through.

## Fix

Added two fields to each `sample_plays` row, both derived from data already on the play object (no new
fetch, no schema change upstream):
- `open_position: p.positionId != null` — mirrors `open_position_count`'s own real-ledger-row test.
- `commit_gate_blocked: (p.commitGateBlockedBy?.length ?? 0) > 0` — the same evidence
  `entry-verdict.ts`'s member-facing WAIT pill already keys on, now surfaced per-row to Largo too.

Regression test: `src/lib/largo/product-reads-swing-sample-gate-blocked.test.ts`, mirroring the
existing `product-reads-swing-open-count.test.ts`'s mock pattern — one fake gate-blocked/no-position
candidate (AMD, matching the live repro) and one fake real open position (AAPL), asserting the sample
row for each carries the correct `open_position`/`commit_gate_blocked` pair. RED confirmed via
`git stash` (both new fields read `undefined` without the fix, failing the `equal(..., false)` /
`equal(..., true)` assertions); GREEN confirmed after restoring. `npx tsc --noEmit` clean; full
`src/lib/largo/product-reads*.test.ts` sweep (40 tests / 14 suites) passes with no regressions.

## Blast radius

Single function (`compactSwingLane`), single call site (`swingHorizonForLargo`, itself the SWING half
of `nighthawkHorizonsForLargo` → the `get_nighthawk_horizons` tool). Purely additive — two new fields
on an existing sample object, nothing removed or renamed, so no existing consumer (test or otherwise)
of `sample_plays` breaks. Does not touch `commitGateBlockedBy`/`positionId` computation itself, the
real-time commit gates, or any live-capital path — evidence-surfacing only, same discipline as the
2026-09-08 `open_position_count` fix it completes.

## Fix rationale

Chose per-row fields over, e.g., filtering gate-blocked candidates out of the sample entirely, because
LARGO-PRODUCT-CONTRACT.md's absence principle (C3) argues for surfacing an honest "here's what's
happening and why it's blocked" over silently hiding a real, discovery-flagged candidate — the same
choice the 2026-09-08 fix made (keep `committed_count` as-is, add a note + a second field) rather than
redefining what `status: "COMMIT"` means system-wide, which would be a much larger, riskier change
touching every other consumer of that status label.
