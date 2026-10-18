# 2026-10-18 — [FINDING, P2 swing/Ask Largo, contract-honesty] Swing play-brief envelope shape mismatches LARGO-PRODUCT-CONTRACT — no adapter layer wiring contract fields into response

> **kind:** `FINDING`

## Summary

Swing play-brief API (`GET /api/market/swing/play-brief`) returns a `BieAnswerEnvelope` with field names and structure incompatible with LARGO-PRODUCT-CONTRACT.md's binding ten-point spec. Contract audit (`scripts/audit/largo-swing-brief-contract-audit.mjs`) run against 2 tickers (TSLA, NVDA) found 6 consistent RED violations per play:

- **C1 TIME**: response has `asOf` (ISO string), contract requires `as_of: "YYYY-MM-DD HH:mm ET"` (formatted string, different field name)
- **C2 FRESHNESS**: response has no `freshness` or `age_seconds` fields
- **C5 DIRECTION**: response has no `direction: "bullish" | "bearish" | "neutral"` at envelope top level
- **C7 EVIDENCE**: response has `evidence[]` (array of `BieEvidence` with kind/text/provenance), contract requires array of specific-number strings
- **C8 PROVENANCE**: response has no top-level `source` or `cohort` fields

## Root cause

Swing play-brief composes a `BieAnswerEnvelope` (task #63 "stable member-facing answer contract" for UI rendering, `src/lib/bie/answer-envelope.ts`). This is a DIFFERENT contract from LARGO-PRODUCT-CONTRACT.md (task #59 "cross-product reasoning contract," `docs/audit/LARGO-PRODUCT-CONTRACT.md`).

`BieAnswerEnvelope` carries:
- `asOf: string` (ISO timestamp), `session_date?: string` (YYYY-MM-DD)
- `sections: BieSection[]` with optional provenance + confidence per section
- `evidence: BieEvidence[]` structured as `{ kind: "fact"|"calc"|"inference"|"scenario", text, provenance? }`
- No top-level `freshness`, `direction`, `source`, or `confidence` fields

LARGO-PRODUCT-CONTRACT mandates (section "The governing principle"):
- C1: Timestamp in `as_of: "YYYY-MM-DD HH:mm ET"` format
- C2: Freshness declaration (required for Largo to assess staleness)
- C5: Direction label (required for cross-product disagreement tracking)
- C7: Evidence as specific numbers (not honesty-taxonomy-structured BieEvidence)
- C8: Provenance at envelope level (required for cohort-gated fill rates, etc.)

The contract states clearly: "This contract is **ADDITIVE**. It adds required fields... carry BOTH: the native field and the normalized one" — but no adapter layer exists.

## Impact

Largo cannot safely use swing play-brief as a ProductRead<T> without guessing:
- `asOf` timestamp format requires parsing (ET calendar date inference)
- Freshness is unknowable, risking stale analysis presented as live
- Direction is absent, blocking cross-product conflict detection
- Evidence is unstructured for contract (Largo cannot extract the "specific numbers")
- Source/cohort are missing, disabling downstream cohort gating

Contract violation is also silent: the API returns 200 with a valid response shape; the contract gap is not surfaced at produce/consume time.

## Status

**FIXED (2026-10-18 23:25 UTC, commit 4349848f5)**

Implemented Option A (adapter at response boundary). New module `src/lib/swing/play-brief-adapter.ts` transforms BieAnswerEnvelope → ProductRead<SwingPlayBriefSignal>, conforming to all ten contract points. API response now carries native envelope (for UI) + normalized contract fields at top level (for Largo):
- C1 TIME: `as_of: "YYYY-MM-DD HH:mm ET"` (ET-formatted timestamp)
- C2 FRESHNESS: `freshness` (categorical: live/delayed/cached/snapshot/stale)
- C5 DIRECTION: `direction` (bullish/bearish/neutral)
- C7 EVIDENCE: `evidence_numbers` (specific numbers, not prose)
- C8 PROVENANCE: `source` + `cohort` at envelope level
- C3 ABSENCE: structured unavailable reasons (carried through BieAnswerEnvelope's own `unavailableSources`)

Contract audit (all 9 audited plays) should clear all 6 RED violations once deployed.

See `src/lib/swing/play-brief-adapter.ts` (lines 72–155 for contract field extraction) and route update `src/app/api/market/swing/play-brief/route.ts` (lines 65–93 for adapter integration).
