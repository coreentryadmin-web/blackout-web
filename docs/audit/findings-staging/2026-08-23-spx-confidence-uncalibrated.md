## 2026-08-23 — [FINDING, P0 SPX Slayer] Confidence score is not calibrated to play outcomes

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | The `confidence` field stored in every play payload is computed as `clamp(round(|score|·1.15 + #factors·3), 0, 96)`, which produces a ceiling-hit constant of **96 on all measured plays** (n=51, 2026-08-23 audit). Measured win rate on those same 51 plays: **51%**. The verdict bar renders this constant and implies a calibrated conviction metric — members reading "96" reasonably expect a 96%-ish win rate, edge ratio, or similar. Actual performance is ~50%. |
| **Root cause** | The confidence formula is arbitrary. `|score|·1.15 + #factors·3` was never validated against real outcomes. Score range is ±100 (clamped), factors range 7–10, so most plays land in the 60–90 range, rounded and clamped to the 96 ceiling. The formula treats confidence as a *scale of conviction* when it is really a *normalized score histogram*. |
| **Evidence** | `spx-play-outcomes.ts` ledger audit (2026-08-23): 51 closed plays, all carrying `confidence: 96`, 26 wins + 25 losses = 50.98% actual win rate. `spx-play-engine.ts:706` computes the constant formula; no calibration boundary exists. No stored plays have `confidence != 96` because the ceiling is tight. `scripts/audit/spx-confidence-calibration.mjs` shows `r(|score|, win) = 0.172` and `r(grade_rank, win) = −0.038` (n=51, indicative only — too small for confidence). |
| **Scope** | Every play in the ledger carries the mislabeled confidence. Every surface that renders `play.confidence` directly (verdict bar, alerts, exports) inherits the false precision. The `assessed` flag was added 2026-08-23 to mark fabricated confidences, and the verdict bar now suppresses them when `!assessed`. That removes the false publication but doesn't calibrate the number. |
| **Why it wasn't caught earlier** | Nobody had measured play outcomes against the formula. "Tests pass" does not validate against real trading. The confidence formula was asserted as reasonable and never questioned. |
| **Blast radius** | Every surface that published the `confidence` field to members. `SpxPlayVerdictBar` renders grade + score; it does not currently render the raw `confidence` field (design choice, not bug). But the field travels in the API payload, exports, and any downstream consumer. |
| **Fix** | This issue has **three parts, not one**: (1) **Honest labeling:** if the field is to remain a score, label it `score` not `confidence`. (2) **Calibration:** derive a calibrated confidence from real outcomes using the stored plays as training data. (3) **Backfill:** once calibrated, recompute all stored plays. **Part 1 (labeling) can ship immediately.** Parts 2–3 require ~264 closed plays for statistical power (6–8 weeks of trading data). |
| **Labeling fix (immediate)** | Rename the field from `confidence` to `rawScore` or `scoreValue` in `SpxPlayPayload`. Any surface that renders it should label it as a **raw score**, not a conviction metric. (Alternatively, keep `confidence` but change all references to `score`.) **Decision:** rename to `rawScore` in the type, update all renders to label as "Score". This removes false precision without waiting for calibration. |
| **Calibration fix (deferred)** | (1) Collect ~264 closed plays. (2) Split 80/20 train/test. (3) Build a logistic regression or similar from `score`, `grade`, `#factors` → actual outcome (win/loss). (4) The predicted probability is the calibrated confidence. (5) Validate on the 20% holdout. (6) Compute for all stored plays. (7) Deploy the new formula. Ownership: SPX lane. Timeline: 6–8 weeks. Measurement: `scripts/audit/spx-confidence-calibration.mjs` shows the data and preliminary correlations. |
| **Status** | **PARTIALLY FIXED 2026-08-23 (labeling deferred, calibration pending).** The `assessed` flag suppresses fabricated confidence; a 96 `confidence` on a play without a recorded assessment is now marked as unmeasured. Proper labeling + calibration still pending. |
| **Post-deploy validation** | After renaming to `rawScore`: (1) No API consumer should read the field and interpret it as a calibrated metric. (2) Every render should label it as "Score", not "Confidence" or "Conviction". (3) No member should see the constant 96 and expect it to predict outcomes. (4) Once calibrated (6–8 weeks), measure accuracy on new closed plays. |

---

## Dependent decisions

This finding touches the confidence layer that several surfaces consume:
- The verdict bar (currently suppresses uncalibrated via `assessed` flag)
- The Signal Analytics panel (shows the underlying `score` already, not the `confidence` field)
- API exports / commentary (may render raw `confidence`)

**Recommendation:** Land the labeling fix this week (rename + suppress fabrication). Confidence calibration is the P0 work item blocking "we promise 96% conviction" language anywhere in product copy.

