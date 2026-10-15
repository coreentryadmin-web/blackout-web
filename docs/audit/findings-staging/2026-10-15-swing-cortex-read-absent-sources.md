> **kind:** FINDING

## Swing play-brief `cortexReadSection` never surfaced absent Cortex sources (Largo C3) — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — completeness gap against the Largo product contract's absence principle |
| **File** | `src/lib/swing/play-brief-intel.ts` (`cortexReadSection`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`cortexReadSection` reads `play.cortex.verdict` (`CortexVerdict`), which carries `absent: string[]` —
the sources that couldn't produce a read this turn (the Largo C3 absence principle: "if it can't see
something, say so, don't silently drop it"). Every other verdict-to-prose renderer of this exact
`CortexVerdict` type in the codebase (`src/lib/bie/cortex-read.ts`'s `assembleVerdictEnvelope`,
`buildPinnedCortexEnvelope`, `composeCortexForTicker`) states an absent-source count in its headline
or confidence rationale — an established house pattern for this type. `cortexReadSection`'s header
built from `vetoCount`/`opposeCount`/`v.score`/`v.conviction` only, and never touched `v.absent` —
not gated by any staleness/bucket/absence comment, just never wired.

This is a realistic production shape, not theoretical: `cortex-source-timeout-outcome-ab.mjs`
(already in the audit toolkit) measured ~19% of graded 0DTE commits carrying a real
`CortexSourceTimeout` via the same shared `fetchVectorFullState` fan-out that swing's
`gex-walls`/`wall-trend`/`darkpool-confluence` Cortex sources also read — so a veto/oppose-bearing
swing Cortex read with simultaneously absent sources is not a rare corner case.

### Evidence

New regression tests (`play-brief-intel.test.ts`). Pre-fix (RED, verified via `git stash` isolation):
a verdict with 2 absent sources rendered no mention of them at all. Post-fix (GREEN): header states
"2 sources absent"; a verdict with zero absent sources still renders no absent-source clause at all
(no fabrication for the clean case).

### Fix

Appended a `· N source(s) absent` clause to the existing header string, gated on `absentCount > 0`
(omitted entirely when nothing was absent — matches the Largo contract's omission-over-fabrication
discipline). No other logic touched.

### Blast radius

Single call site — `cortexReadSection` only reads `play.cortex`, only called from
`buildIntelSections` in the same file. No other function in `play-brief-intel.ts` renders a
`CortexVerdict` to prose.
