## 2026-09-13 — [FINDING, P2 Largo/CI, NOT FIXED — needs Largo-lane + infra investigation] `largo-stress-nightly` has failed every night for 5+ consecutive nights via two distinct, confirmed-systemic failure modes — 5 open, zero-comment auto-created issues going unaddressed

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED, NOT FIXED — spans a real product-answer-quality question (Largo's honesty grounding on self-critical/comparative questions) and an unidentified rate-limit source; neither is a small mechanical fix, and the fix path requires a judgment call this lane shouldn't make unilaterally. |
| **Severity** | P2 — no member-facing outage, but the nightly Largo quality gate has been silently red for at least a week, its own auto-triage mechanism has created 5 tracking issues that nobody has looked at (0 comments across all 5), and the gate design means each night measures a shrinking, incomplete slice of the test bank while still reporting a specific number (`live_quality_pct`) that reads as if it covered the whole run. |

### What was found

DISCOVERY-cycle sweep of recent GitHub Actions failures (as part of the standing Ask-Largo ownership mandate's every-cycle deep-dive) found the `Largo stress nightly` scheduled workflow (`.github/workflows/largo-stress-nightly.yml`, `scripts/largo-stress-run.mjs`) has failed on **every single scheduled run for at least 10 consecutive days** (2026-09-02 through 2026-09-13). The workflow auto-creates a `ops-auto-fix`/`largo`-labeled GitHub issue on each failure; the 5 most recent (#4585, #4654, #4724, #4783, #4922 — 2026-09-08 through 2026-09-13) are all still **open with zero comments** — nobody has investigated any of them.

### Two distinct, confirmed-systemic failure modes (not one bug, not random noise)

**Mode 1 — a late-run `http-429` storm loses 30-40% of test coverage, every night.** Compared two full run logs six days apart:
- **2026-09-11** (bank 2, 100 questions): clean for the first ~55 questions (real 15-95s LLM answers), then from ~12:04 UTC onward, the large majority of remaining requests return `http-429` in **1.6-2.6 seconds** (vs. 15-95s for a real answer) — the server is rejecting them outright, not processing them slowly. **33 of 100 questions (33%)** ended up `SKIP`ped as transport failures; one 401 mid-run cost another 103 seconds on re-auth+retry.
- **2026-09-13** (bank 4, 121 questions): identical shape — clean until ~12:34 UTC, then a wall of `http-429`s at 1.6-1.7s response times for most of the rest of the run. **43 of 121 questions (35.5%)** skipped.
- This is not noise or a one-off runner hiccup: same shape, same rough timing-into-the-run, same instant-rejection signature, on two different question banks six days apart. `largo-stress-run.mjs`'s own `askLiveThrottleAware`/`freshCookie` logic (lines 153-267) already has real infrastructure for Clerk-session-expiry (401) recovery — the 429s are a **separate, unhandled** failure class the script does not retry or back off from, it just marks them `SKIP` and moves on. The script does not itself fail the job on transport skips (only warns) — but it silently reduces the run to measuring 65-70% of what it claims to measure, and the `live_quality_pct` figure in the summary output describes only the answered subset without that caveat being visible anywhere except a console warning line.

**Mode 2 — a recurring `honesty-no-grounded-numbers` BAD verdict on open-ended/self-critical/comparative questions, which is what actually fails the CI job** (`scripts/largo-stress-run.mjs` line 307: `if (summary.live_bad > 0) process.exit(1)`):
- **2026-09-11**: BAD on *"where is the desk wrong on SPX if anything"* → `honesty-no-grounded-numbers`.
- **2026-09-13**: BAD on *"difference between Vector and Thermal in Largo"* → `honesty-no-grounded-numbers` (same tag).
- **Different exact questions, same failure tag, same question SHAPE** — both are open-ended, comparative/self-critical prompts ("where are you wrong", "what's the difference between X and Y") rather than a direct data lookup. This is consistent with a real pattern: Largo's answers to this class of question apparently tend to read as prose commentary without citing the specific grounded numbers the stress scorer requires — either a genuine answer-quality gap for this question shape, or the scorer's bar is miscalibrated for legitimately-more-qualitative questions. Either explanation is a product/scoring judgment call, not a one-line fix.
- Because the CI gate has **zero tolerance** (any single `BAD` verdict fails the whole job) across a bank of ~78-100 *scored* questions (after transport skips are excluded) spanning a wide range of prompt shapes, a genuine ~1% single-question quality miss is enough to redline the entire nightly run — which, given LLM-answer non-determinism, may make an occasional real 1-in-100 miss statistically likely even if Largo's aggregate quality is otherwise fine. Whether that's "working as intended" (a strict bar catching a real, if rare, honesty gap) or "gate too strict for a stress harness this size" is exactly the kind of call that belongs to whoever owns the Largo stress harness's design, not this lane.

### Why this wasn't dismissed as "probably just flaky, not worth flagging"

Both modes were checked against a SECOND independent run (different date, different bank, different exact questions) before writing this up, specifically to rule out a one-off blip — per this repo's own "flake is not a root cause, prove it before calling it one" discipline. Both reproduced with the same shape. The zero-comment status on 5 consecutive open issues is itself evidence this has not been investigated, not evidence it isn't real.

### Why write-up, not direct fix

- **Mode 1** needs identifying WHERE the 429 is actually coming from (Largo's own tool-loop/Anthropic API rate limit, Clerk's FAPI limit, a Next.js API-route-level throttle, or something else) before a fix (backoff+retry, reduced concurrency, or raising a quota) can be chosen correctly — guessing and papering over the symptom with a blind retry risks masking a real capacity signal.
- **Mode 2** needs a judgment call on whether to (a) improve Largo's answer generation for self-critical/comparative questions to ground more consistently in specific numbers (a real Largo prompt/product change), or (b) recalibrate the stress scorer's `honesty-no-grounded-numbers` check for this question shape, or (c) accept single-question misses as expected noise and change the CI gate from zero-tolerance to a threshold. All three are the standing Ask-Largo-mandate's kind of "own this, make it better" decision, not a mechanical bug fix — flagging with full evidence rather than picking one unilaterally.

### Suggested next steps

1. For Mode 1: add response-header/error-body capture to `askLiveThrottleAware` on a 429 (currently discarded) to see which upstream is issuing it, or check CloudWatch around a run's ~30-minute mark for the matching outbound call.
2. For Mode 2: pull `honesty-no-grounded-numbers`-tagged BAD verdicts across more nights (the pattern here used only 2 samples) to confirm the "self-critical/comparative question shape" hypothesis holds up, then decide the fix per the three options above.
3. Either way: the 5 open, zero-comment `ops-auto-fix`/`largo` issues should get triaged/closed once whoever owns this acts, rather than continuing to accumulate silently.
