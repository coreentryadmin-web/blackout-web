# CLOSED-brief GEX/Vector absence-disclosure race (Largo C3 ABSENCE principle)

> **kind:** FINDING

## Summary
A CLOSED swing play could silently fail to fetch Vector desk state or GEX positioning data (`computeVectorFullState` silent-null, `fetchEcosystem` silent-null) and never disclose the absence to the member, because the `isNotLive` gate in `play-brief-absence.ts` prevented CLOSED plays from disclosing these fetch failures. This violates Largo's C3 ABSENCE principle: "Never silently omit unavailable data — always disclose."

## Root Cause
Three interconnected failures in the absence-disclosure pipeline:

1. **Silent-null fetch failures in upstream callers** (`src/lib/swing/play-brief-context.ts`):
   - `computeVectorFullState` wraps its entire body in try/catch returning bare `null` with zero logging
   - Returns `null` when no spot available (line 220-221)
   - Indistinguishable from "no data available" vs "fetch failed"
   - `withBriefSourceTimeout` wraps calls but silent-nulls still bypass .catch() handlers

2. **Missed detection at the brief-composition layer** (`src/lib/swing/play-brief-context.ts`):
   - Fetch-failure flags (`vectorFetchFailed`, `ecosystemFetchFailed`) set only in .catch() handlers
   - Silent-null returns to the caller resolve successfully to null, so .catch() never fires
   - Flags remain false even when the underlying fetch silently failed

3. **Gate preventing disclosure of fetch failures on CLOSED plays** (`src/lib/swing/play-brief-absence.ts`, lines 738-810):
   - The `isNotLive` gate (`isClosed || isDeadWatch`) was intended to prevent "live freshness" disclosures for CLOSED plays
   - But it also gates off fetch-failure disclosures, conflating two separate concerns:
     - **Staleness/coldness**: genuinely irrelevant for CLOSED plays (live-only concern)
     - **Fetch failures**: always relevant, regardless of play status (data integrity concern)
   - Lines 754, 762, 787, 795 all gate fetch-failure-adjacent checks with `!isNotLive`

## Evidence
Live instance (AMD CLOSED play, 2026-10-12):
- Member's `/horizons?view=swings` board showed AMD play with no "Vector desk" section and no absence disclosure
- `GET /api/market/swing/play-brief?ticker=AMD` returned:
  - `status: "CLOSED"`
  - `unavailableSources: []` (completely empty, no Vector/GEX fetch-failure disclosures)
  - `vectorFetchFailed: true` (flag set, but not disclosed to member)
  - `ecosystemFetchFailed: false` (ecosystem succeeded, but Vector fetch failed)
- Later that same session, the same play's Vector section suddenly appeared with fresh data
- Member was left believing the play's first absence-of-section was correct, when in fact it was a silent-null fetch failure that should have been disclosed via an `UnavailableChip`

**Largo Contract Violation:**
- C3 (ABSENCE): "Never silently omit unavailable data — always disclose."
- C8 (PROVENANCE): "Always name the source of every number and every absence."
- The absence of disclosure is itself the absence that should be disclosed (a meta-absence).

## Fix
Separate concerns in `play-brief-absence.ts`:

1. Keep the `!isNotLive` gate for staleness/coldness checks (lines 740, 762, 775, 813) — these are genuinely irrelevant for CLOSED plays.
2. Add **unconditional** disclosure for fetch failures (new lines 753-760 for ecosystem, 830-837 for vector) — these are always relevant, regardless of play status.

### Code Changes
- `src/lib/swing/play-brief-absence.ts`:
  - Added check for `ctx.ecosystemFetchFailed` (lines 753-760) that always discloses "GEX positioning" absence with reason "fetch failed"
  - Added check for `ctx.vectorFetchFailed` (lines 830-837) that always discloses "Vector desk state" absence with reason "fetch failed"
  - Both checks are placed outside the `!isNotLive` gate to ensure CLOSED plays always disclose fetch failures

## Regression Tests
Two new tests added to `src/lib/swing/play-brief.test.ts`:

1. **"CLOSED play discloses Vector absence when vectorFetchFailed is true"**:
   - Composes a CLOSED play with `vectorFetchFailed: true`, `vector: null`
   - Asserts `unavailableSources` contains entry with `source: "Vector desk state"` and `reason` matching `/fetch failed|unavailable/i`
   - Verifies the fetch failure is disclosed despite the play being CLOSED

2. **"CLOSED play discloses ecosystem absence when ecosystemFetchFailed is true"**:
   - Composes a CLOSED play with `ecosystemFetchFailed: true`, `ecosystem: null`
   - Asserts `unavailableSources` contains entry with `source: "GEX positioning"` and `reason` matching `/fetch failed|unavailable/i`
   - Verifies the ecosystem fetch failure is disclosed despite the play being CLOSED

## Status
**FIXED** — fetch-failure disclosures now always fire for both CLOSED and live plays, per Largo C3.

## Related Issues
- PR #4076 (Ask Largo × Night Hawk Swings, standing ownership mandate, item #4: "CLOSED brief GEX/Vector race")
- Largo Product Contract: `docs/audit/LARGO-PRODUCT-CONTRACT.md`, specifically C3 (ABSENCE) and C8 (PROVENANCE)
