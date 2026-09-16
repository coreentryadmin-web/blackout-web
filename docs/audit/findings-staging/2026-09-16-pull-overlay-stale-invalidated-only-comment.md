## 2026-09-16 — [FINDING, FIXED] `pull-overlay.ts`'s header comment said only INVALIDATED engages the pull latch — PR-N6's severe-degradation pull path was undocumented

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 — documentation-only; zero behavioral impact |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/pull-overlay-stale-invalidated-only-comment |

### Root cause

`pull-overlay.ts`'s module header stated: "An INVALIDATED morning-confirm verdict latches
`pulled` on the play's outcome row." Read while reviewing this file ahead of tomorrow's
pre-market morning-confirm run (found immediately after fixing a similarly-stale comment in
`debrief-aggregate.ts` this same cycle — same defect class: a comment describing an earlier,
narrower version of a mechanism that has since grown a second trigger path).

Traced the real write path: `morning-verdict-persist.ts:166-173` computes
`shouldPull = invalidated || degradedSevere`, where `degradedSevere` comes from
`isDegradedSevere` (PR-N6, same file, lines 51-58) — a DEGRADED (not INVALIDATED) verdict is
ALSO pulled when it's a gap-away entry or carries `>= DEGRADED_SEVERE_REASON_COUNT` distinct
stacked reasons. So a play can be pulled without ever having been INVALIDATED, which the
header comment didn't describe.

Also verified, while tracing this, that the generic fallback reason string in
`applyNighthawkPullOverlay` (`row.pulled_reason ?? "Pulled pre-open by the morning
confirmation check"`) is a pure defensive backstop rather than the common path — the single
real writer (`morning-verdict-persist.ts:179-181`) always constructs a specific
`Pulled pre-open...: <status.reason>` string whenever `shouldPull` is true, so
`pulled_reason` is never actually null in the live write path. No fix needed there; this is
just now stated in the comment rather than left to be re-derived.

### Fix

Rewrote the header comment to name both pull triggers (INVALIDATED and PR-N6's
severe-degradation path) and to state the fallback-string observation above. No behavioral
change — comment only.

### Blast radius

Single comment, single file. `pull-overlay.ts` has no other doc comments describing the pull
trigger condition.

### Tests

None added — pure comment change. `tsc --noEmit` clean post-edit.
