## `play-brief-absence.ts`'s GEX flip-reason disclosure table used the wrong vocabulary — 2 of 3 real reason codes silently dropped the C3 chip — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo × Night Hawk Swings standing mandate, Workflow static-code sweep
of not-yet-audited `play-brief-*.ts` files against `docs/audit/LARGO-PRODUCT-CONTRACT.md`.

**Root cause:** `collectGexFlipAbsence`'s `GEX_FLIP_REASON_DISCLOSURE` lookup table
(`src/lib/swing/play-brief-absence.ts`) existed specifically to surface WHY a gamma-flip level is
null — a genuine data gap vs. an honest structural fact (per its own 2026-10-08 doc comment, the
original fix for the INTC live repro). But its keys were a drifted vocabulary, not the real
`GammaFlipReason` string literals (`src/lib/providers/gex-cross-validation-core.ts`:
`"resolved" | "insufficient_strikes" | "net_short_everywhere" | "crossings_far_from_spot"`) that
`polygon-options-gex.ts` actually assigns to `gex.flip_reason` at its two real producer call sites
(`flip_reason: gexFlipDetail.reason`). The table used `insufficient_data` (real:
`insufficient_strikes`) and `crossings_far` (real: `crossings_far_from_spot`) — so a real
`flip_reason` of either of those two genuine data-gap codes matched NOTHING in the table, and
`collectGexFlipAbsence` silently returned `null` (no disclosure chip) for both — reproducing, for
2 of the 3 real reason codes, the exact C3 absence-disclosure silence this function was built to
fix in the first place. `net_long_everywhere` (also in the old table) was never a real value at
all: `cumulativeGammaFlipDetail`'s own doc comment confirms the cumulative-gamma definition can
only go null on the "never turns positive" (net-short-everywhere) side — there is no symmetric
"net-long-everywhere" null case the current algorithm can produce.

**Why it wasn't caught:** the existing regression test for the `insufficient_data` case used the
IDENTICAL wrong fixture string (`flip_reason: "insufficient_data"`), so it passed against the bug
instead of catching it — the test and the production code shared the same stale vocabulary, traced
back to `gex-positioning.ts:92`'s own loosely-worded doc comment. There was no test at all for
`crossings_far_from_spot`.

**Live impact:** any ticker whose GEX matrix is fresh but has either genuinely too few strikes
(`insufficient_strikes`) or every crossing sitting outside the plausible band
(`crossings_far_from_spot`) renders with a silently-missing "gamma flip" level and nothing in
`unavailableSources` explaining why — a member or Largo reader cannot distinguish "we don't have
it yet" from "there genuinely isn't one," the exact ambiguity this function's own header comment
says it exists to resolve.

**Fix:** Corrected the two wrong keys to the real `GammaFlipReason` values, dropped the dead
`net_long_everywhere` entry, and retyped the table as `Partial<Record<GammaFlipReason, {...}>>`
(imported from `gex-cross-validation-core.ts`) instead of a bare `Record<string, {...}>` — a
future rename or removal of a `GammaFlipReason` value now fails this table at compile time instead
of silently drifting out of sync again. The read site casts `gex.flip_reason` (loosely typed
`string | null` on `GexPositioning`) to `GammaFlipReason | undefined`, documenting the real
invariant (both producer call sites only ever assign a `GammaFlipDetail.reason`) rather than
widening the lookup table's key type back to a bare string.

**Fix rationale:** Minimal, targeted correction to the three key strings plus a type tightening
that directly prevents the SAME failure mode (a disclosure table's vocabulary silently drifting
from its source enum) from recurring undetected. Left the dead `net_long_everywhere` key removed
rather than kept, since the type now makes its deadness a compile-time fact rather than a
by-inspection claim.

**Blast radius:** Single function (`collectGexFlipAbsence`), single lookup table. No other caller
reads `GEX_FLIP_REASON_DISCLOSURE` (repo-wide grep).

**Tests:** Corrected the existing `insufficient_data` test's fixture to the real
`insufficient_strikes` value, added a new dedicated `crossings_far_from_spot` test (previously
uncovered under either spelling). RED→GREEN proven via `git stash` (both new/corrected tests fail
against the pre-fix source — 90/92 pass, 2 fail — pass post-fix, 92/92). `tsc --noEmit` clean.
Full `play-brief-absence.test.ts` (92 tests) green, run on Node 20.
