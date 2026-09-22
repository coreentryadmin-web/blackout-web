# swing-board-allocation.ts repeats the same stale "caps are advisory-only" claim just fixed in its sibling

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (documentation correctness) |
| **Lane** | Night Hawk Swings |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate (2026-09-22), same-cycle follow-up to the `swing-allocation.ts` fix (PR #5425) |

## Root cause

While sweeping `swing-allocation.ts`'s sibling wiring file for the same class of issue, found the
identical stale claim repeated: `swing-board-allocation.ts`'s header said the allocator's decision
"does not gate the engine or resize a real position (swing-allocation returns `enforce:false`).
The portfolio backtest graduates the caps first (PR-16)."

That justification is the exact claim `swing-allocation.ts`'s own header made and was corrected
for in the immediately-preceding fix this cycle: `commit.ts`'s Gate 2 calls `allocateSwingBook`
directly with the real caps and treats a breach as a live block on real commits — the caps are
not waiting on any future graduation.

What IS true, and worth keeping documented, is narrower: this file's own exported
`allocateSwingBoard` function has **zero callers anywhere in the app** (confirmed by grep — only
its own test file references it), so whatever it computes never reaches a served board today. The
file conflated "my own wrapper is unwired" (true) with "the underlying caps are advisory" (false,
per the sibling fix) — the same shape of conflation, just one level removed.

## Fix

Corrected the header to state the real reason this file's output never gates anything (zero
callers, not un-graduated caps), and pointed to `swing-allocation.ts`'s header for the full trace
of where the caps actually do gate. Documentation-only — no logic touched.

## Evidence

`npx tsc --noEmit`: clean. `swing-board-allocation.test.ts`: 4/4 pass. Full
`src/lib/swing/*.test.ts`: 1503/1503 pass — confirms zero behavior change.

## Blast radius

One file, comment-only. No caller reads it programmatically.
