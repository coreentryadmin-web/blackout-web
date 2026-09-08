# Swing CTO audit — critical/high fixes batch

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Audit** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` (PR #4178) |
| **Findings** | #1, #5, #6, #8/#9, #12 |

## Rolled-chain closed brief showed wrong leg P&L (#1)

`loadClosedPlay()` reused `closedDeckSourcesFromChains`, which applies chain-composite worst-leg P&L for the CLOSED deck list. A positionId-keyed Ask Largo brief now uses `closedDeckSourceFromRow(target)` so exit P&L matches the requested leg.

## TRIM manageAction stuck on TAKE_PARTIAL (#5)

`manageObservablesFromEvent` now clears the status-derived `TAKE_PARTIAL` fallback when the latest manage snapshot action is `HOLD`.

## dataHonestyCoaching markIsSync polarity inverted (#6)

Coaching now warns when `markIsSync === true` (no `markAsOf`), matching `dataFreshnessSection` polarity.

## Ask Largo live brief missing thesis factors (#8/#9)

`play-brief-resolve.ts` now calls exported `attachThesisExplanation` (same as main board serving lane) after `livePlayFromSwingPosition`.

## Short volume ratio displayed as 2500%+ (#12)

`normalizeShortVolumeRatio` in `ticker-fundamentals.ts` converts percent-scale upstream values (>1) to 0–1 before render.
