# FULL PRODUCT CERTIFICATION — LARGO

Ordered directly by the user, relayed by the coordinator. Do not assume Largo is complete, correct,
optimized or feature-complete because it shipped or CI is green. This is not a code review and not a
superficial UI walkthrough. You must independently PROVE the whole cross-product agent is correct,
useful, reliable, fast and competitive.

Your member surface is `/terminal` (the whole member surface — confirm `LargoDeskMiniPanel.tsx`
really is still orphaned before certifying that as settled) plus `/admin/largo-answer-preview`. The
framework below is written for a chart-and-panel product; adapt its letter to Largo's actual shape
(a chat agent whose "panels" are the 129 tools' payloads and whose "numbers" are the claims those
payloads let it make) rather than skipping sections that don't map literally.

## 1. Inventory everything
Every slash command, every tool (all 129 in `capability-registry.ts`/`tool-defs.ts`), every UI
element on `/terminal` (input, message list, citations/evidence rendering, caveat footers, session
controls, share-to-Discord, draft-X-post), every API (`/api/market/largo/{query,session,status,
context,mini-panel,slash-prompts,draft-x-post,share-discord}`), every empty/loading/error/degraded
state.

## 2. Validate every number (= every factual claim Largo makes)
For every tool, and for a representative sample of real questions across every product (Helix,
Thermal, Vector, Meridian, Night Hawk, SPX): what does the payload mean, where does it originate, how
fresh is it, what happens on a source-unavailable/degraded case, can the number Largo states be
independently verified against the product's own page? Re-run `largo-truncation-probe.mjs` against
ALL 129 tools this time (not just the ones already known-good), with the control proven each run — a
tool never probed is INDETERMINATE, not a pass. Trace: SOURCE → PRODUCT LAYER → TOOL PAYLOAD →
`anthropicToolLoop` (16k char cap) → MODEL → ANSWER TEXT → CITATION/EVIDENCE → CAVEAT FOOTER.

## 3. Validate every label
Does Largo say "confidence" when a product omitted confidence because it can't calibrate one
(LARGO-PRODUCT-CONTRACT.md's rule)? Does it fabricate certainty by inventing a number a product
deliberately left out? Does the caveat footer actually fire when coverage is low, and does it
OVERSTATE coverage when it's actually thin? Does Largo silently reconcile two products' genuine
disagreement (contract says represent, never reconcile) — test directly with a question spanning
Helix and Vector on the same tape.

## 4. Validate every "panel" (= every answer shape/tool cluster)
For each tool cluster (per-product query tools, cross-product tools, admin tools): why does it
exist, what decision does it help a member make, is it correct, is anything missing or redundant,
does the answer format serve the question. Is the 127-tool surface right-sized, or is there
duplication/dead weight (the orphaned `mini-panel` tool is one already-known example — are there
others)?

## 5. Test every interaction
Drive `/terminal` like a real member: real questions across every product, every slash command, a
session reset, a spend-ceiling/degraded case if constructible, share-to-Discord and draft-X-post end
to end, mobile viewport, navigate-away/back, a tool erroring mid-answer. Confirm the RESULTING ANSWER
is correct and honestly caveated, not just that the UI responds.

## 6. Validate the logic
RAW TOOL RESULT → TRANSPORT (16k cap, key-order-decides-survival) → DISPATCH → VERIFICATION
(`verifyClaims`/`ClaimVerification.coverage`) → CAVEAT DECISION (`applyVerificationCaveat`) →
EMPTY-ANSWER FALLBACK (`classifyEmptyAnswer`) → SPEND CEILING → OUTPUT. Wrong dispatch, silent
truncation, verification that doesn't verify what it claims, a caveat firing on the wrong condition,
untested spend-ceiling paths.

## 7. Audit the architecture
Map TRANSPORT → TOOL DISPATCH → TOOL PAYLOADS → CONTRACT COMPLIANCE → GROUNDING/VERIFICATION →
SPEND CEILING → SYSTEM PROMPT → CROSS-PRODUCT COHERENCE → UI → OBSERVABILITY → PRODUCTION. 18,947
lines in `src/lib/largo/` across 138 files — duplicated logic, fragile coupling to any one product's
internal shape, single points of failure (the 16k transport cap already broke three tools in another
lane — a systemic fix rather than per-tool patches?), observability gaps.

## 8. Performance certification
Time-to-first-token, full-answer latency (simple vs multi-tool-call questions), tool-call round-trip
latency, spend per question, payload sizes per tool (which are closest to the 16k cap across every
product, not just the ones already caught).

## 9. Product & UX review
Think like a trader asking Largo a real question under time pressure. Immediately useful? Tells me
what changed and why? Points me to the right product page? Caveat/uncertainty language honest without
being so hedgy it's useless?

## 10. Find new features
USER PROBLEM, PROPOSED CAPABILITY, WHY EXISTING PRODUCT DOESN'T SOLVE IT, DATA REQUIRED, EXPECTED
TRADER VALUE, IMPLEMENTATION COMPLEXITY, RISK, HOW SUCCESS WILL BE MEASURED. Classify P0/P1/P2/P3.

## 11. Competitive review
What do excellent AI-trading-assistant products do that Largo doesn't? What does Largo already do
better (a genuine cross-product view most competitors can't build without owning the underlying
data)? What's the moat and is it actually being used?

## 12. Find what wasn't asked about
What would a prompt-injection-minded security engineer try against `/terminal` (tool results are
external-ish data — has anyone tried to get a tool payload hijack Largo's own instructions)? What
would a skeptical quant ask that would break the grounding/verification layer? What fails during an
extreme multi-product event (FOMC day, all six products disagreeing at once)?

## 13. Evidence — the certification matrix
Produce and commit `docs/audit/LARGO-CERTIFICATION.md`: COMPONENT | FIELD/INTERACTION | SOURCE/LOGIC
| VALIDATION PERFORMED | RESULT | ISSUE | SEVERITY | ACTION | EVIDENCE | STATUS (NOT TESTED/TESTING/
FAILED/FIXING/DEPLOYED/LIVE VERIFIED). Nothing is LIVE VERIFIED without production evidence.

## Reporting back
The coordinator will challenge "everything looks good" / "tests pass" / "CI is green." Every real
defect gets the standard fix/branch/test/findings-staging/PR treatment per CLAUDE.md — P0s first,
one issue per PR. Do not batch every fix into one giant PR. The coordinator pulls status on its own
cycle — front-load anything P0. No permanent DONE — CURRENT VERSION CERTIFIED, then back to
OBSERVE → QUESTION → DISCOVER → ANALYZE → IMPROVE → TEST → DEPLOY → VERIFY → MEASURE → REPEAT.
