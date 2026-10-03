> **kind:** FINDING

## Night Hawk Legacy-promoted swing candidates — no graduation path into the real commit pipeline — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — architectural (commit-pipeline gap; not a live-trading-path defect — nothing was mis-executing, a real-but-triggered thesis just structurally could never reach the commit gate) |
| **Branch/PR** | `fix/legacy-swing-lifecycle-live-reclassification` |

### CORRECTION — this finding originally also claimed a frozen-classification bug. That part was wrong and has been withdrawn (same day, before merge)

The original write-up (and the PR it staged for) claimed DELL/NVDA showing `FORMING`/`PRE_TRIGGER`
for several days despite price crossing the trigger meant `setupState`/`entryStatus` were frozen at
first-promotion-day values and never recomputed. That diagnosis was **wrong**, caught live during
routine monitoring the same day: ZS and SHOP (two of the same WATCH rows the claim was built on)
correctly flipped `FORMING`→`TRIGGERED` on production, with `firstSeenAt` unchanged — proving live
reclassification already happens. Traced the real mechanism: `swing-active-refresh` (a 15-minute,
market-hours-only cron) refreshes `spotsByTicker` for every name in the persisted WATCH snapshot —
Legacy rows included, nothing special-cased, "so FORMING/TRIGGERED stays current" per its own
comment — and `serving-lane.ts`'s `enrichPlay()` recomputes `setupState`/`entryStatus` fresh via
`swingServingMetaFromDossier` on **every** `/horizons` request, never trusting whatever was
persisted. The original DELL/NVDA observation was pre-market staleness (that cron doesn't run
outside market hours) read as a structural bug — not a defect. The live-reclassification code this
PR had added to `refreshCarriedLegacyPlay`/`carryLegacyPromotedIntoSnapshot` was reverted; it was
solving an already-solved problem via a redundant path, not causing harm, but not needed either.

### Root cause (the part that still stands)

Every Legacy-promoted row carries `bucketGraduated: false` and `commitGateBlockedBy:
["legacy:exempt"]` hardcoded permanently — not a stale flag, but a structural fact: these rows live
entirely in `legacy-confirm-promote.ts`'s own persisted serving snapshot, a data path completely
disjoint from `accumulation-store.ts` (the ONLY store `discovery.ts`'s commit loop reads real
candidates from via `fetchWatchEligible` → `computeSwingCommitPlan`). A Legacy thesis can never
reach the real commit gate at all, regardless of how clearly its underlying triggers — confirmed
structurally true even on a row (ZS, 2026-10-01) sitting at live `TRIGGERED`/`AT_TRIGGER` with a
correctly up-to-date classification: it is still permanently exempt from ever becoming a real
position no matter what the price does.

### Fix

`legacyCommitCandidatesFromSnapshot` is the bridge: a Legacy triple whose `setupState==="TRIGGERED"`
and `entryStatus` at `"AT_TRIGGER"`/`"PULLBACK_TO_ENTRY"` — the SAME observable gate `serving.ts`'s
router requires for an organic candidate to reach `COMMIT_NOW` — becomes a real
`SwingCommitCandidate`, built from its own already-materialized dossier/contract (no new fetch). It
is designed to be appended to `discovery.ts`'s existing `commitCandidates` array before the REAL,
UNMODIFIED `computeSwingCommitPlan` runs — same G-S3/G-S4/G-S6/G-S12/G-S14 gates, same armed-budget
+ book-percent caps + idempotency, zero duplicated or weakened logic. Deliberately does NOT invent a
"NIGHT HAWK" confluence kind — a Legacy-only candidate carries zero Tier-0 discovery-path provenance
unless independently screened this same scan, so G-S6 (>=2/3 independent kinds) legitimately blocks
a Legacy-only signal exactly as it would any other under-corroborated single-source candidate.
`removeCommittedLegacyFromSnapshot` drops a committed ticker from the persisted WATCH snapshot so it
is not also carried forward as a duplicate thesis.

### Evidence

25 new/extended tests in `legacy-confirm-promote.test.ts` (all passing, zero regressions across the
full swing suite, 1568/1568): the graduation bridge's TRIGGERED+AT_TRIGGER filtering (built directly
against hand-constructed play states — the already-working live reclassification is not this file's
concern), real-Tier-0-path crediting (never fabricated), snapshot cleanup, and — the decisive proof —
two **FULL LIFECYCLE** tests that feed a Legacy-sourced candidate into the REAL, imported, unmodified
`computeSwingCommitPlan` (never reimplemented) and confirm: (1) it commits once TRIGGERED+AT_TRIGGER
with a real quote, (2) idempotency still blocks a duplicate open on a second run against a book that
already holds it, (3) G-S6 confluence still blocks it when V2 confluence is enforced and it carries
zero independent corroboration — proving no gate was bypassed or weakened.

### What was deliberately NOT shipped this PR (flagged for explicit follow-up, not silently done)

The actual live-cron wiring of `legacyCommitCandidatesFromSnapshot`'s output into `discovery.ts`'s
`runSwingDiscoveryScan` commit loop (`computeSwingCommitPlan` call, ~line 1087) requires reordering
`swing-discovery/route.ts` so Legacy carry-forward runs BEFORE that scan's own commit loop, not after
it (current order, confirmed by reading the route). That is real surgery inside the live-money cron's
control flow and was deliberately left as a precisely-scoped follow-up rather than rushed through in
the same pass — per the operator's own explicit instruction not to change production behavior until
the lifecycle is demonstrated correct, which this PR does via the pure functions + the full-lifecycle
integration tests, without yet touching the cron's call order.
