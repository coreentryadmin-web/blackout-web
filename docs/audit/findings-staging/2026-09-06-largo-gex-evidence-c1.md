> **kind:** FINDING

## Swing play-brief: GEX dealer posture prose-only + date-only C1 helper — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-LARGO-001 |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED (pending merge) |

### Root cause

1. **C7:** `dealerPostureLine()` narrated gamma posture and net GEX in markdown sections, but `evidenceFromContext()` never emitted structured dealer-posture rows — Largo's evidence rail could not ground trade-manager dealer reads (same class as #4311 HELIX flow fix).

2. **C1:** Fundamentals `as_of` dates arrive as `YYYY-MM-DD`; `etStampFromIso()` parses them as UTC midnight → prior ET evening, inverting session joins. Helper `etStampFromDateOrIso()` anchors date-only observations at session close.

3. **C1:** `sessionDate` was computed in context loader but not returned on `SwingPlayBriefResult`.

### Fix

- `evidenceFromContext()`: emit `Dealer posture: γ … · net GEX …` calc row when `gex_positioning.gamma_posture` is set.
- `etStampFromDateOrIso()` in `bar-session-date.ts` for date-only observation stamps.
- `SwingPlayBriefResult.sessionDate` forwarded from context.

### Evidence

- `npx tsx --test src/lib/swing/play-brief.test.ts` — GEX evidence + sessionDate tests GREEN.
- `npx tsx --test src/lib/largo/temporal/bar-session-date.test.ts` — date-only stamp test GREEN.
