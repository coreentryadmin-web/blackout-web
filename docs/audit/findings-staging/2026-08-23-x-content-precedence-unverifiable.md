# 2026-08-23 — X content: precedence claims ("we called it first") are unverifiable

> **kind:** FINDING

## Claim

The brief explicitly requires foresight claims to be timestamped and verifiable: "BLACKOUT caught it first requires timestamped platform evidence proving the detection preceded the move. No evidence, no claim." Current system has no `signal_timestamps` field, no chronology validator, and no way to distinguish actual foresight from backfilled analysis.

## Evidence

**Brief requirement** (`docs/agents/briefs/x-content.md` §Chronology):

> Never rewrite history. If BLACKOUT identified something only *after* the move, the post says so.  
> **"BLACKOUT caught it first" requires timestamped platform evidence proving the detection preceded the move. No evidence, no claim.**  
> Enforce this **mechanically, not editorially**. A package asserting precedence must carry the two timestamps it is comparing in structured fields, and a validator must refuse to mark it `READY` if the detection timestamp is not strictly earlier than the market event.

**Current system:**
- No `signal_timestamps` field in queue (queue doesn't exist yet)
- No validator to check detection < event
- Posts like "10:34 ET — Helix detects flow ... 11:18 ET — NVDA +2.1%" can be constructed after the move with no way to verify the 10:34 timestamp is real

**Defect class:** A post claiming "we saw this coming" is maximally credible when it's real foresight. It is maximally *damaging* if it's backfilled — the account claims predictive power it doesn't have. This is the defect class the brief calls "the single most damaging thing this account could publish."

## Status

BLOCKING FORESIGHT CLAIMS, REQUIRES QUEUE + VALIDATOR

## Impact

Without mechanical validation:
- Any foresight claim is editorial hand-waving, not falsifiable
- Auditor cannot distinguish real foresight from backfilled hype
- Account credibility is at risk if claims are later proven false
- Learning loop cannot measure foresight accuracy (no way to know which claims were real)

## Root Cause

`signal_timestamps` is not a field in the pipeline. It would need to be:
1. Captured at signal detection time in the product (Helix, Thermal, Vector, etc. each need an instrumented detection timestamp)
2. Stored in the queue row
3. Checked by validator before marking package READY

Currently:
- No queue row (P0 #1)
- No detection timestamps in source products (architectural, requires changes across 7 teams)
- No validator to check precedence

## Fix

**Two-phase:**

**Phase 1 (Immediate, for queue):** Add `signal_timestamps` field to queue schema:

```typescript
signal_timestamps?: {
  detection: {
    product: string; // "Helix" | "Thermal" | "Vector" | ...
    timestamp: Date; // detection time in ET
    evidence: string; // screenshot URL or description
  }[];
  market_event?: {
    timestamp: Date; // when market event occurred (VWAP break, level test, etc.)
    evidence: string; // screenshot of price action
  };
};
```

**Phase 2 (When queue lands):** Implement chronology validator:

```typescript
function validateChronology(pkg: QueueRow): {ok: boolean; error?: string} {
  if (!pkg.signal_timestamps) return {ok: true}; // no claim, no validation needed
  if (!pkg.signal_timestamps.market_event) {
    return {error: "foresight claim missing market_event timestamp"};
  }
  const firstDetection = Math.min(...pkg.signal_timestamps.detection.map(d => d.timestamp));
  if (firstDetection >= pkg.signal_timestamps.market_event.timestamp) {
    return {error: `detection (${firstDetection}) not before event (${pkg.signal_timestamps.market_event.timestamp})`};
  }
  return {ok: true};
}
```

Validator must refuse to mark package READY if this check fails.

## Authority

**Brief:** Explicitly mechanical requirement, not guideline  
**Mandate:** Item 13 (evidence matrix) requires foresight claims to carry timestamps

---

**Surface:** Foresight claim validation  
**Likelihood:** High (any foresight claim triggers this risk)  
**Detectability:** Low (unverifiable without mechanical check)  
**Deployed version:** N/A (feature not yet shipped, but needed before first foresight post)  
