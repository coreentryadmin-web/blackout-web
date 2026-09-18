# G-23's qualify-to-commit dislocation had a real predicate but no way to measure its real distribution

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED (additive telemetry — no gate/behavior change) |
| **Severity** | P3 (observability gap, not a live defect — the gate itself was already correct and already fail-closed on missing data) |
| **Area** | 0DTE — `src/lib/zerodte/scan.ts` (`persistZeroDteScan`'s `entry_context` builder); reads `gates.ts`'s existing `qualificationDislocationGateBlocks` (G-23) inputs |
| **Found by** | Night Hawk three-engine deep audit (0DTE `NEEDS_MEASUREMENT` item — instrument G-23 before considering a premium-side check) |

## Root cause / gap

G-23 (`qualificationDislocationGateBlocks`, shipped 2026-09-09) blocks a fresh 0DTE commit when
the underlying moved too far, too fast, since the setup qualified (magnitude+velocity trigger) or
the contract's book is crossed/locked at commit time. The predicate itself was correct and already
tested — but it only ever surfaces as a formatted `reason` string on the rare commit it actually
blocks. Nothing pinned the same elapsed-ms/move-pct math for the (presumably much larger)
population of commits that DID clear the gate, so there was no way to ask, from real production
data, how large the real qualify-to-commit gap typically is, or whether the gate's own
1.5%/5-minute threshold is well-calibrated against that distribution — only anecdote.

## Fix

Purely additive telemetry, no gate/scoring/behavior change: `persistZeroDteScan` now pins a
`qualification_dislocation_telemetry` blob onto `entry_context` for every committed row, computed
from the same two frozen fields (`qualification_underlying_price`/`_as_of`) and the same live
fields (`underlying_price`/`_as_of`) the gate itself already reads — same formula
(`elapsedMs = currentAsOf - qualificationAsOf`, `movePct = |current - qualification| / qualification
× 100`), deliberately recomputed rather than read off the gate verdict so the telemetry can never
disagree with what actually decided a block. Omitted (never zero-filled) when either snapshot is
missing, matching the "never fabricate" discipline of every other evidence-only field in this
object (`origin_direction_conflict`, `session_gap_days`, etc.).

## Why this and not a premium-side check yet

The cross-question review that surfaced this item explicitly named the sequencing: instrument
first, then decide whether a premium-side (contract mark) dislocation check is warranted, based on
real accumulated data — not before. This PR only ships the instrumentation.

## Evidence / tests

Added two tests to `src/lib/zerodte/scan.test.ts`:
- pins the telemetry blob (qualification/current price+as-of, `elapsed_ms`, `move_pct`) on a
  commit that clears G-23 (1% move over 2 minutes, under the 1.5%/5-min trigger) — proving the
  telemetry is captured regardless of whether the gate actually blocks.
- omits the blob entirely (not a null-filled shape) when no qualification snapshot was ever frozen
  (the ordinary case for any setup path that doesn't call `enrichSetup`).

Verified RED before the fix (both new tests fail) / GREEN after (39/39 `scan.test.ts` pass),
`tsc --noEmit` clean.

## Next step (not this PR)

Once 1-2 weeks of live commits have accumulated this field, pull
`GET /api/market/zerodte/record` and build the real qualify-to-commit elapsed/move-pct
distribution before considering any premium-side dislocation check or threshold retune.
