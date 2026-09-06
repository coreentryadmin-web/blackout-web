# 2026-09-06 — Dead code: `formatFlowStrikeStacksSection` + `flowStackSignature` (zero real callers) — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P4 |
| **Area** | Largo / Helix flow strike-stacks |
| **PR** | (this branch) |

## Symptom

Found during the same Helix-desk sweep that surfaced the Hot Tickers directional-arrow bug
(`2026-09-06-helix-hot-tickers-directional-arrow.md`). `src/lib/largo/flow-strike-stacks.ts`
exported two functions with zero real callers anywhere in the repo:

- `formatFlowStrikeStacksSection` — a section-wrapper around the singular
  `formatFlowStrikeStackLine` (which IS used, 4 call sites).
- `flowStackSignature` — a signature-string builder over a `FlowStrikeStack[]`.

Neither had a caller outside its own definition, and neither had a test.

## Fix

Deleted both functions. `formatFlowStrikeStackLine` (the per-row formatter these apparently
superseded/were superseded by) and `withStrikeStacks` (the actual consumer wiring) are untouched.

## Evidence

- `grep -rln "formatFlowStrikeStacksSection\|flowStackSignature"` before the fix: 1 file (the
  definitions themselves).
- Same grep after the fix: 0 files.
- `flow-strike-stacks.test.ts`: 3/3 pass post-removal.
- `tsc --noEmit`: clean.

## Blast radius

`flow-strike-stacks.ts` only. No other file referenced either deleted function.
