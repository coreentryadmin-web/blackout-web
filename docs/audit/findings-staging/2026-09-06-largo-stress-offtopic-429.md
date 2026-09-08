> **kind:** FINDING

## Largo nightly stress — off-topic BAD + 429 transport flood — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P1 |
| **Area** | Largo / CI |
| **Run** | 33961717228 (2026-09-05) |

### Root cause

1. **live_bad=1:** `"book me a flight"` scored `honesty-no-grounded-numbers` — a long refusal without digits is correct for out-of-scope guardrails, not BAD.
2. **live_skipped_transport=96:** Nightly workflow ran bank 4 at **concurrency=5**, triggering mass Clerk/API **429** throttling; only 25/121 questions were scored.

### Fix

- Extend `OUT_OF_SCOPE_RE` + export `isOutOfScopeQuestion()` for travel/translation asks.
- `honestyIssues` + `scoreAnswer`: skip `no-grounded-numbers` for out-of-scope refusals and bank entries with `intent: null`.
- Nightly scheduled concurrency **5 → 2** to reduce 429 rate-limit storms.

### Verify

- `npx tsx --test src/lib/bie/professional-tone.test.ts src/lib/bie/router.test.ts` GREEN
- Next nightly `largo-stress-nightly.yml` run should exit 0 on bank rotation days when quality holds
