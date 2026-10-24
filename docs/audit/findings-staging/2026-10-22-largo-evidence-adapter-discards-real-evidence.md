> **kind:** FINDING

## `extractEvidence()` (Largo swing adapter) discarded the brief's real `envelope.evidence[]` in favor of a headline/bias restatement

| **Status** | FIXED |
|------------|-------|

**Symptom:** Largo product-contract C7 ("the specific numbers behind the claim, not a
restatement of it" — `ProductSignal.evidence`'s own doc comment). `play-brief-adapter.ts`'s
`extractEvidence()` never read `envelope.evidence` at all — the real, sourced evidence array
`evidenceFromContext` (`play-brief.ts`) builds for exactly this purpose (dealer-posture strike/γ
reads, HELIX flow $ premiums/print counts, earnings dates, peer lists — literal numbers). Instead
it manufactured its own list out of exactly what C7 disclaims: the headline+bias repeated
verbatim, each section's bare bias word, and confidence prose. A model reading the structured
`evidence` field saw zero of the brief's real sourced numbers, only a paraphrase of the claim
those numbers are supposed to back up.

**Root cause:** the function was written independently of `evidenceFromContext`'s real array and
never wired to read it — a dead-contract-field defect, not a logic bug in either function.

**Fix:** `extractEvidence` now leads with `envelope.evidence[].text` (every real fact/calc/
inference/scenario entry). Levels/scenarios/invalidation stay (they carry real numbers too); the
pure-restatement bits (headline+bias, section bias words, confidence prose) are dropped. The bare
headline+bias fallback is kept ONLY for the genuine-emptiness case, so the contract's non-empty-
array requirement (`contractViolations`) is never satisfied by fabrication.

**Verify:** `play-brief-adapter.test.ts` — new case confirms a real `evidenceFromContext` fact
(earnings-calendar date) reaches the Largo-facing `evidence[]` unchanged.
