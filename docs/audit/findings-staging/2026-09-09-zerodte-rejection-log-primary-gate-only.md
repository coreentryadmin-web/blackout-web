> **kind:** FINDING

## 0DTE gate-rejection log only ever recorded the FIRST failing gate — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | 0DTE Command (`src/lib/zerodte/gates.ts`, `board.ts`, `rejections.ts`, `src/lib/db.ts`) |
| **Severity** | P2 (analysis/observability gap, not a live-trading bug) |

### Root cause

`evaluateZeroDteGates` (gates.ts) already collects the FULL set of failing gates for a
candidate into `verdict.blocks[]` — deliberately, so a SKIP card can say "tape + window"
instead of only the first reason. But `gateRejectionFor` (gates.ts:1690, the bridge that
turns a verdict into a durable `zerodte_scan_rejections` row) only ever persisted
`blocks[0].code` as `gate_failed` — the first-evaluated gate, not every gate that fired.
`gates.test.ts:629`'s own test name documented this as intentional: *"one row per blocked
setup — primary code, ALL reasons concatenated"* (the human-readable `reason` text
concatenates every block's sentence, but the machine-readable codes did not).

This made a specific, high-value analysis permanently impossible from historical data:
computing which gates are actually *redundant* with each other (a candidate that fails
both G-1 and G-12 only ever recorded whichever one happened to evaluate first — the fact
that G-12 ALSO fired was silently discarded) or building a per-gate marginal-value/ablation
study ("what commits if we remove gate X" requires knowing every gate a historical
rejection failed, not just its primary one). Raised directly by the operator during an
architecture review of the gate stack (2026-09-09) — the review correctly identified that
several gates (G-1/G-4/G-10/G-12/G-13) plausibly measure overlapping "does the environment
agree with this direction" phenomena, and that testing this requires per-gate
attribution data the codebase was not actually capturing.

### Evidence

- `gates.ts:1690-1719` (`gateRejectionFor`): `gate_failed: primary.code` (only
  `blocks[0]`); `reason` concatenates every block's sentence, but no field carried the
  set of codes.
- `gates.test.ts:629`, test title explicitly confirms this was the documented, intended
  behavior at the time: *"gateRejectionFor: one row per blocked setup — primary code, ALL
  reasons concatenated"*.
- `src/lib/db.ts` `zerodte_scan_rejections` schema (~line 1563) had no column for the full
  gate set — only `gate_failed TEXT NOT NULL` (singular).
- Confirmed no other table/field anywhere in the 0DTE schema recorded this either (checked
  `zerodte_setup_log.gate_calibration_json`, which only pins G-4/G-6 calibration for
  COMMITTED plays, not the full block set for REJECTED candidates).

### Fix

Additive, no behavior change to live gating/commits:
- `ZeroDteGateRejection` (board.ts) gains an optional `blocks?: ZeroDteGateFailure[] | null`
  field — every failing code, not just the primary one.
- `gateRejectionFor` (gates.ts) now populates it: `verdict.blocks.map(b => b.code)`.
- `zerodte_scan_rejections` gains a `blocks_json JSONB` column (idempotent
  `ADD COLUMN IF NOT EXISTS`, same pattern `counterfactual_json`/`reason` already use —
  additive nullable, rows written before this column existed carry NULL forever).
- `insertZeroDteScanRejection`/`fetchZeroDteScanRejections` (db.ts) read/write the new
  column; `persistZeroDteRejections`/`fetchZeroDteRejections`/`zeroDteRejectionsForLargo`
  (rejections.ts) thread it through, including exposing it to the existing Largo
  `get_zerodte_rejections` tool payload.
- The per-ticker write throttle (`rejectionStateKey`, rejections.ts) now includes the
  full sorted `blocks` set alongside `gate_failed`/`direction` — a candidate that starts
  failing a SECOND gate underneath its unchanged primary code is a real state transition
  the ablation analysis needs captured, not jitter to suppress (the existing throttle
  correctly still excludes the genuinely jittery numeric fields — gross_premium,
  aggression, etc.).

### Blast radius

Four files, all additive: `board.ts` (type), `gates.ts` (population), `db.ts` (schema +
read/write), `rejections.ts` (plumbing + Largo tool payload). No existing column removed
or repurposed, no gate logic changed, no commit/board behavior changed. Tests updated:
`gates.test.ts` (asserts the full `blocks` array on both the multi-block and null-verdict
cases), `rejections.test.ts` (asserts `blocks` round-trips through `insertZeroDteScanRejection`,
and that a changed full gate set — same primary — is treated as a real transition, not
suppressed as jitter).

### What this does NOT fix (by design — see the caveat)

This is a **going-forward** instrumentation fix only. It cannot retroactively reconstruct
which gates fired on historical rejections written before this column existed — those rows
carry `blocks_json: NULL` forever, same as `counterfactual_json` on rows predating
`skip-grading.ts`. A real gate-ablation / marginal-value-matrix study (per the operator's
review) needs `blocks_json` to accumulate live for a meaningful window before it has real
N to work with; it cannot be built today from history that was never captured this way.
A restricted version (primary-gate-only Blocked WR/EV via the already-existing
`skip-grading.ts` counterfactual, Passed WR/EV via the committed ledger) IS buildable
today without waiting, and is the planned next step.
