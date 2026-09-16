## 2026-09-16 — [FINDING, FIXED] Read-time outcome overlay silently undid the gate-promote conviction cap on every edition read

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — a mechanically-rescued gate-promoted play could display as top-tier ("A") merit to members, exactly the class of misleading conviction `capGatePromotedConviction` exists to prevent |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/legacy-outcome-overlay-gate-promote-cap |

### Root cause

`publish-gates.ts`'s `promoteTopBlocked` rescues the top-scoring gate-blocked plays with
`gate_promoted:true` when the organic count is below the ops minimum, and immediately calls
`capGatePromotedConviction` to cap any A+/A rescue down to "B" — the function's own comment states
the intent directly: "a mechanically blocked A does not read as top-tier overnight merit." This cap
is applied **once**, at build time, before the edition is persisted.

Separately, `publish-context.ts` pins `publish_context.tier` from the **raw tier-engine assignment**
(`assignNighthawkTier(nhTierInputFromScored(scored))`) — computed from the scored candidate alone,
with no knowledge of whether the play was later gate-promoted. The same pinned object also carries
`gate_promoted: play.gate_promoted === true` right alongside `tier`, but nothing downstream read it.

`edition-outcome-overlay.ts`'s `applyEditionOutcomeOverlay` runs on **every** `GET
/api/market/nighthawk/edition` request (`edition/route.ts`'s `withOutcomeOverlay`), reading that
pinned `publish_context.tier` back out and unconditionally setting `next.conviction =
overlay.tier.tier` — with no check against `gate_promoted`. For a gate-promoted play whose raw tier
engine assignment was "A" (capped to "B" at publish time), every subsequent live read of the
edition silently re-inflated `conviction` back to "A", defeating the cap on the very same request
path members actually see.

### Evidence

Repo-wide trace: `edition-outcome-overlay.test.ts` had zero coverage of the `gate_promoted`
interaction (confirmed via grep — no `gate_promoted`/`gatePromoted` reference anywhere in the test
file). Traced the call chain live: `edition/route.ts` → `withOutcomeOverlay` →
`applyEditionOutcomeOverlay`, confirmed it runs on the read path, not just at build. Confirmed
`publish_context.tier` is populated independently of `gate_promoted` (`publish-context.ts:267-272`
gates only on `scored` being non-null, which a gate-promoted play's dossier carries same as any
other).

### Fix

`applyEditionOutcomeOverlay` now pipes its tentative `conviction` assignment through the same
`capGatePromotedConviction` (`publish-gates.ts`) the build-time path already uses, rather than
re-deriving the cap logic inline or ignoring gate-promote status. Reusing the existing, tested
capping function means both paths (build-time publish, read-time overlay) can never drift apart —
a future change to the cap's threshold or letter automatically applies to both.

### Blast radius

Single call site (`edition-outcome-overlay.ts`'s only consumer, `edition/route.ts`). No other
readers of `overlay.tier`/`next.conviction` exist (grepped `applyEditionOutcomeOverlay`/
`buildOutcomeOverlayMap` repo-wide — only the route and the test file).

### Tests

New regression test constructs a gate-promoted play already capped at "B" and a tier pin whose raw
assignment is "A", asserting the merged play stays at "B". RED confirmed pre-fix via `git stash`
(new test fails against the original source), GREEN confirmed post-fix. `tsc --noEmit` clean.
