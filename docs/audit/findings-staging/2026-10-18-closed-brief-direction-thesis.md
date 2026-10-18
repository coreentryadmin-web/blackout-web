# CLOSED Swing Play-Brief direction/thesis omission — Largo C5/C8

**Date:** 2026-10-18  
**Kind:** FINDING — Largo contract C5/C8 gap, WATCH status  
**Severity:** P2 — impacts envelope completeness but not data integrity (both fallbacks present: `bias` field, `headline` text)

## The issue

`GET /api/market/swing/play-brief` on CLOSED swing positions returns envelopes with:
- ✓ `bias` field correctly set from `play.direction`
- ✓ `headline` includes the direction/recommendation label (e.g. "HOLD — ...")
- ❌ **`direction` field is null/missing** — Largo C5 violation
- ❌ **`thesis` field is null/missing** — Largo C8 narrative violation

Tested 3 real CLOSED chains (NVDA, CRWV, TSLA) post-deployment 2026-10-18 22:46 UTC, all return the same pattern.

## Root cause

`composeSwingPlayBrief` (src/lib/swing/play-brief.ts) constructs the envelope by spreading `buildRichEnvelope()` output but never explicitly adds the `direction` or `thesis` fields. The `bias` fallback masks this for UI rendering, so the omission is silent.

- Line ~1510: `buildRichEnvelope({...bias: biasFromDirection(play.direction),...})` — passes bias but not direction
- Lines 1530-1540: Final envelope assembly spreads the rich envelope but adds no separate `direction`/`thesis`
- Return statement (line 1546+): Returns SwingPlayBriefResult with the incomplete envelope

## Why it matters

- **Largo C5 (DIRECTION):** Contract requires the actual `direction` field for programmatic direction access (not just fallback to `bias`)
- **Largo C8 (NARRATIVE):** Contract expects a `thesis` field — currently members see sections but no single normalized thesis claim
- **Cross-product consistency:** Vector, 0DTE, Helix briefs all provide explicit `direction`/`thesis` fields; CLOSED swings do not

## Fallbacks present (why it's not RED)

- `bias` field is correctly set, so UI card colors render correctly
- `headline` text includes the recommendation (e.g. "HOLD", "EXIT"), so readers see the intent
- This is a **field-completeness** issue, not a **correctness** issue

## Proposed fix (not implemented yet)

Add explicit `direction` and `thesis` fields to the envelope in `composeSwingPlayBrief`:

```typescript
const envelope: BieAnswerEnvelope = {
  ...buildRichEnvelope({...}),
  direction: play.direction || null,        // Add explicit direction
  thesis: /*synthesized from play data*/ || null,  // Add thesis synthesis
  // ... existing source, asOf, etc.
};
```

The `thesis` field requires deciding on synthesis logic (terminal leg status + archetype? entry hypothesis? first section body?).

## Status

**WATCH** — Documented as a gap, not blocking anything currently (fallbacks present), but priority for next ask-largo sweep to close before expanding swing brief usage.

This is independent of PR #6145 (Vector/GEX fetch-failure disclosure), which shipped correctly and is validated live.

## Verification command (for next session)

```bash
node << 'EOF'
import { fetchAuditJson, releaseAuditClerkSession } from "./scripts/audit/lib/audit-auth-fetch.mjs";
const res = await fetchAuditJson("https://blackouttrades.com", "/api/market/swing/play-brief?playId=SWING:NVDA&ticker=NVDA");
console.log("Has direction:", !!res.json.envelope?.direction);
console.log("Has thesis:", !!res.json.envelope?.thesis);
await releaseAuditClerkSession();
EOF
```
