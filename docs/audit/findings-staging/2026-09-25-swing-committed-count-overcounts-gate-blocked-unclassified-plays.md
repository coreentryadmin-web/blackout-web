## `board.lanes.SWING.committed`/`committedCount` overcounted unclassified/FORMING plays the router itself sends to WATCH or RESEARCH — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings board |
| **Severity** | P2 (correctness — member/Largo-facing inflated committed total, not a data-availability bug) |
| **Status** | FIXED |
| **File** | `src/lib/swing/serving-board.ts` (`assembleSwingServingLane`) |

### Root cause

The same bug class as the already-fixed `watch` back-compat field (2026-09-23, see the entry above
this one), just on the `committed` side, which that earlier fix explicitly left untouched on the
stated belief "no live-position entry-window-expiry case exists for it." That belief was never
re-verified against a live board and turned out to be wrong in a different, adjacent way:
`committed` was derived with `plays.filter((p) => p.status === "COMMIT")` — a raw floor-gate-result
filter that never consulted `sectionForSwingPlay`/`buildSwingSections` at all, so a pre-entry play
with no real setup-maturity read (unclassified) or one still `FORMING` its thesis kept being counted
as "committed" even though the router correctly places both in `WATCH`/`RESEARCH`, never
`COMMIT_NOW`/`WAITING_FOR_ENTRY`.

This is distinct from — and narrower than — the already-intentional design where a score-qualified
but real-time-gate-blocked thesis (`commitGateBlockedBy` non-empty, e.g. `gate:G-S12:halt_feed_stale`)
legitimately stays in `committed`: two existing regression tests
(`src/lib/largo/product-reads-swing-open-count.test.ts`, 2026-09-08, and
`product-reads-swing-sample-gate-blocked.test.ts`, 2026-09-22) already establish and lock in that
`committed_count` = every "floor cleared" thesis (`COMMIT_NOW ∪ WAITING_FOR_ENTRY` plus the three
live-position sections), with the Largo product-read layer disclosing gate-blocked/no-position rows
via a separate `open_position_count` and per-row `commit_gate_blocked`/`open_position` flags rather
than by excluding them from the count. The bug fixed here only removes plays the router itself never
considered floor-cleared-and-actionable in the first place (`WATCH`/`RESEARCH`), which is a strict
subset of what raw `status === "COMMIT"` was letting through.

### Evidence

Live repro, 2026-09-25 (~00:19 ET, non-RTH): `GET /api/market/nighthawk/horizons?view=swings`
reported `board.lanes.SWING.committedCount: 91`, while `GET /api/market/swing/record`'s
`summary.opens` (the real tracked-position count: 4 native + 78 banger) was `82`. Tracing the
9-name gap: all 9 carried `status:"COMMIT"`, `positionId:null`, `liveStatus:null`, and a non-empty
`commitGateBlockedBy` (`gate:G-S12:halt_feed_stale`, `gate:G-S6:confluence`,
`gate:G-S14:cortex_thin_evidence`, or `legacy:exempt`) — and the router placed all 9 in
`sections.WATCH` (6: TEAM, MSFT, FSLY, NOW, PANW, CLF) or `sections.RESEARCH` (3: AMD, BMNR, VKTX),
never `COMMIT_NOW`. 6 of the 9 were byte-identical duplicate objects appearing in BOTH `committed`
and `watch` simultaneously — the same array-object-shared-across-two-back-compat-fields shape the
2026-09-23 `watch` fix already fixed on the WATCH side, just unfixed on the COMMIT side.

### Fix

`assembleSwingServingLane` now derives `committed` from the already-computed `sections` object —
`COMMIT_NOW ∪ WAITING_FOR_ENTRY ∪ MANAGING ∪ SCALING_OUT ∪ EXITING` (every section except `WATCH`
and `RESEARCH`) — instead of independently re-filtering raw `p.status`. This matches the
already-documented `committedCount` semantics the two product-reads.ts regression tests lock in
(floor-cleared, not necessarily open — that disambiguation stays at the Largo layer) while making
it structurally impossible for `committed` to include a play the router itself sent to WATCH or
RESEARCH.

Regression test added (`src/lib/swing/serving-board.test.ts`): a gate-blocked, `FORMING`-setup play
with real `commitGateBlockedBy` and no `positionId` confirmed RED before the fix (appeared in
`lane.committed`) / GREEN after (excluded from `lane.committed`, still reachable in
`lane.sections.WATCH` — routed away, not dropped). An existing test's fixture (ticker `A`) also
needed a `setupState:"TRIGGERED"`/`entryStatus:"AT_TRIGGER"` addition — without any setup-maturity
read at all it routes to RESEARCH by the router's own "unclassified → RESEARCH" rule, so the old
fixture was unknowingly exercising the exact shape this fix now excludes from `committed`. Full
collateral: 112 tests across the directly-touched files (serving-board, product-reads swing
open-count/gate-blocked/watch-count-note/freshness, serving-lane, discovery, commit,
horizons route) plus a broader 4,926-test sweep across `src/lib/swing`, `src/lib/largo`,
`src/features/nighthawk` — all pass. `tsc --noEmit` clean.
