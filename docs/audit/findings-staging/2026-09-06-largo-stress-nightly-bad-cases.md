> **kind:** FINDING

## Largo nightly stress — router ??? + honesty false BAD — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P1 |
| **Area** | Largo / CI |
| **Run** | 34029670177 (2026-09-06) |

### Root cause

Nightly `validate:largo-stress-live-all` exited 1 with `live_bad=4`, `router_mismatch=1`, `live_quality_pct=83.3`:

1. **`???` → compound_lookup** — stress `isCompoundQuestion` treated any string with ≥2 `?` as compound, including pure punctuation nonsense the bank expects as `clarify_read`.
2. **`honesty-no-grounded-numbers` on scenario/concept/platform_read** — long qualitative answers for "what if NVDA rips 3%", "calendar spread on SPY", and "full platform snapshot" were scored BAD even when they correctly explained mechanics or named live desks without re-stating spot digits (common off-hours).

### Fix

- Export shared `isCompoundQuestion()` in `question-focus.ts` with `isNonsenseQuestion` guard; stress harness imports it and checks nonsense before compound.
- Extend `honestyIssues()` intent-aware exceptions for `scenario`, `concept_read`, and `platform_read` structured desk reads.
- Set `AUDIT_STALE_USER_MS=3600000` for live stress runs (45 min runtime vs 30 min sweep gate); honor env override in `prod-clerk-session.mjs` — prevents concurrent harness sweeps from deleting the in-flight stress temp user (`live_skipped_transport: 13` on run 34029670177).

### Verify

- `npx tsx --test src/lib/bie/question-focus.test.ts src/lib/bie/professional-tone.test.ts` GREEN
- Next nightly `largo-stress-nightly.yml` should exit 0 when quality holds
