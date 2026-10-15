> **kind:** FINDING

## Swing play-brief `tickerTrackRecordSection` implied comparability across mismatched directions (Largo C9) — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — precision gap: a bare factual count implied a comparison the data doesn't support |
| **File** | `src/lib/swing/play-brief-intel.ts` (`tickerTrackRecordSection`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`SwingTickerTrackRecord.directions` (`play-brief-ticker-history.ts`) is computed and populated
unconditionally whenever the record exists — its own doc comment states its exact purpose: letting
a caller "tell whether the cited record actually shares the reviewed play's direction before
implying it's a directly comparable 'no edge on this setup' verdict." The sibling narrative function
`tickerHistoryCoaching` (`play-brief-narrative-coaching.ts`, feeding "Trade manager read") already
consumes `directions` correctly to soften its wording on a mixed/opposite-direction record — proving
the field is real, populated, and meaningful. But the DEDICATED "Ticker track record" section/table
in `play-brief-intel.ts` — the one place a member sees the bare win/loss count with no other
qualifier at all — destructured only `{ ticker, priorClosedTrades, wins, losses }` and never read
`directions`. A 0W/2L record built entirely from SHORT trades said nothing about today's LONG thesis
on the same ticker, yet rendered as if it did (Largo C9 precision — don't imply a comparison the
data doesn't support).

### Evidence

New regression tests (`play-brief-intel.test.ts`). Pre-fix (RED, verified via `git stash`
isolation): an all-short prior record for a LONG play rendered no direction qualifier at all. Post-
fix (GREEN): renders "(all short — not all directly comparable to today's LONG setup)"; a mixed
long/short record renders "(mixed long/short — ...)"; a same-direction record and a record that
omits `directions` entirely (older fixture/call site) both render with no qualifier, unchanged.

### Fix

Added the same direction-mismatch check `tickerHistoryCoaching` already uses (optional field, falls
back to the original undifferentiated wording when absent) and appended a parenthetical qualifier to
the existing prose line. The count itself (`wins`/`losses`/`priorClosedTrades`) and the structured
table are unchanged — wording only.

### Blast radius

Single call site — `tickerTrackRecordSection` is only called from `buildIntelSections` in the same
file. No other function renders `SwingTickerTrackRecord` to prose besides the already-correct
`tickerHistoryCoaching`.
