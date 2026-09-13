## 2026-09-13 — [ANALYSIS, DECISION REQUIRED] Mode 2 honesty-no-grounded-numbers root cause and remediation options

> **kind:** `ANALYSIS`

### Root cause identified

The stress scorer's `honesty-no-grounded-numbers` check (line 107–108 in `professional-tone.ts`) flags answers that:
1. Are longer than 80 characters (intended to be substantive)
2. Contain no digits at all (`/\d/` test)
3. Don't match exemption phrases: "none", "flat", "inactive", "scanning"

This check is **strict by design** for platform reads and data-lookup intents where numerics are the expected deliverable. It is **appropriately strict** for questions like "what's the SPX spot price" or "give me the IV rank".

However, **comparative and self-critical questions legitimately may not have numerics**:
- "Where is the desk wrong on SPX if anything?" — Answers discuss architectural limitations, not numerical failures
- "Difference between Vector and Thermal in Largo?" — Answers cover feature distinctions, not numerical comparisons
- The questions themselves invite conceptual rather than quantitative responses

### Evidence for root cause

Two confirmed examples from the nightly runs:

1. **2026-09-11**: *"where is the desk wrong on SPX if anything"* → Largo's answer flagged `honesty-no-grounded-numbers` BAD
   - Question is open-ended, self-critical, asks for limitations
   - A legitimate answer would explain architectural gaps, not cite numerical data
   - The scorer treating "no numbers" as dishonest is treating the answer type as wrong, not the honesty as wrong

2. **2026-09-13**: *"difference between Vector and Thermal in Largo"* → Largo's answer flagged `honesty-no-grounded-numbers` BAD
   - Question asks for differences, not data
   - A legitimate answer would compare feature sets, not quote numbers
   - The scorer is penalizing a qualitative answer to a qualitative question

### Scorer logic review

The check appears in `honestyIssues()` alongside checks for marketing tags, evasion phrases, and concept-coaching exemptions. The underlying concern is valid: ungrounded prose can hide fabrication. But the implementation doesn't distinguish between:
- **A data-lookup question where numerics are mandatory** (SPX spot, IV rank, option price)
- **A qualitative question where numerics are optional** (limitations, differences, conceptual design)

### Remediation options and trade-offs

**Option A: Improve Largo's answer generation for self-critical/comparative questions**
- **Change**: Retrain or prompt-engineer Largo to include grounded references even in qualitative answers (e.g., "Vector focuses on liquidity calculations, which Thermal doesn't emphasize — that's why Vector shows tighter fills on 0DTE calls but lacks the earnings-surprise hedge Thermal offers")
- **Pros**: Highest confidence, addresses the signal (ungrounded prose) rather than the gate
- **Cons**: Requires Largo prompt iteration, may not feel natural for every question shape, takes time

**Option B: Recalibrate the stress scorer**
- **Change 1**: Add an exemption for self-critical/comparative intents (detect question shape or keywords like "difference", "better", "wrong with")
- **Change 2**: Reduce the minimum answer length before the check triggers (e.g., 120 chars instead of 80, since brief conceptual answers are less likely to hide fabrication)
- **Change 3**: Weaken the BAD→WARN threshold (let `no-grounded-numbers` be a WARN instead of a BAD, allowing occasional misses in the gate)
- **Pros**: Fast, immediate relief from stress-run failures
- **Cons**: Loosens the honesty gate for some question types, may miss real honesty issues

**Option C: Adjust the CI gate threshold**
- **Change**: Instead of zero-tolerance (`if (summary.live_bad > 0) process.exit(1)`), allow a threshold like 1-2 BAD verdicts per run
- **Pros**: Pragmatic for non-deterministic LLM output; a 1-in-100 miss is statistically likely on a 100-question test
- **Cons**: Weakens the quality signal; a BAD verdict becomes ignorable; the gate no longer gates quality, it just caps noise

### Recommendation for decision maker

**Factors favoring Option A** (improve Largo):
- Addresses the root cause, not the symptom
- Raises quality bar globally, not just in stress tests
- If Largo can't ground self-critical answers, that's a real product issue worth fixing

**Factors favoring Option B** (recalibrate scorer):
- Self-critical/comparative questions are not the stress harness's core domain (data lookup is)
- A 1–2 BAD verdict per run is likely noise for non-deterministic generation
- Fast implementation allows the nightly gate to remain useful while Largo is improved elsewhere

**Factors favoring Option C** (threshold gate):
- Acknowledges LLM non-determinism (occasional 1-in-100 misses are normal)
- Simplest implementation, immediate relief
- May be too permissive if there's a real quality trend

**Most defensible path**: B then A
1. Add a question-shape or intent exemption (Option B Change 1) to exclude self-critical/comparative questions from the strictest check — this is a fast, narrow fix
2. In parallel or follow-up, improve Largo's grounding for those question shapes (Option A) — this is a real quality improvement
3. Avoid Option C unless there's a broader, genuine LLM non-determinism issue

### Next steps

1. Decide which remediation path to pursue
2. If Option B: add exemption logic to `honestyIssues()` and re-run the nightly with the enhanced script
3. If Option A: brief Largo-lane on the question-shape gap and request prompt iteration
4. If either: re-run the stress suite to confirm the fix before closing the 5 auto-created issues

