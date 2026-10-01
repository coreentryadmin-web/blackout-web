> **kind:** FINDING

## Night Hawk Legacy-promoted swing candidates — frozen setup-maturity classification + no graduation path — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 — architectural (live-trading-path classification + commit-pipeline gap) |
| **Branch/PR** | `fix/legacy-swing-lifecycle-live-reclassification` |

### Symptom (operator-reported, live)

DELL and NVDA (Legacy morning-confirm-promoted WATCH rows) were both first classified
`FORMING`/`PRE_TRIGGER` on 2026-09-28. On 2026-10-01 — three trading sessions later — both still
read `FORMING`/`PRE_TRIGGER`, even though NVDA's underlying had already closed at $228.38, **above**
its own published $225.07 trigger, on 2026-09-30 (confirmed live via Polygon prev-close). ZS and SHOP
showed the identical frozen pattern.

### Root cause (two independent, compounding defects)

**(A) Frozen classification.** `refreshCarriedLegacyPlay` (`legacy-confirm-promote.ts`), the only
function that refreshes a Legacy-promoted row on every subsequent day it is carried forward
(`carryLegacyPromotedIntoSnapshot`), refreshed ONLY the contract's price/DTE fields. `setupState`/
`entryStatus`/`thesisLevel` were copied forward verbatim from whatever `buildLegacySwingArtifacts`
computed on the row's FIRST promotion day — the classifiers (`deriveSetupState`/`deriveEntryPlan`,
`setup-state.ts`/`entry-model.ts`) were simply never called again. This also meant `INVALIDATED`
was structurally unreachable for a Legacy row: a thesis whose underlying closed through its own
structural stop would still read `FORMING` forever.

**(B) No graduation path.** Every Legacy-promoted row carries `bucketGraduated: false` and
`commitGateBlockedBy: ["legacy:exempt"]` hardcoded permanently — not a stale flag, but a structural
fact: these rows live entirely in `legacy-confirm-promote.ts`'s own persisted serving snapshot, a
data path completely disjoint from `accumulation-store.ts` (the ONLY store `discovery.ts`'s commit
loop reads real candidates from via `fetchWatchEligible` → `computeSwingCommitPlan`). A Legacy thesis
could never reach the real commit gate at all, regardless of how clearly its underlying triggered.

### Fix

**(A)** `refreshCarriedLegacyPlay` now accepts an optional `live: { dossier, spot, asOf }` and, when
supplied, re-runs the EXACT SAME pure classifiers the WATCH lane calls on first promotion
(`swingServingReadsFromPlan` → `swingServingMetaFromDossier`, wrapping `deriveSetupState`/
`deriveEntryPlan`) against the dossier's PINNED structural plan levels (entry/invalidation/ATR —
these don't drift daily, only price does) and a FRESH spot. Backward-compatible: omitting `live`
(every existing caller) reproduces the prior behavior exactly. `carryLegacyPromotedIntoSnapshot`
threads a `freshSpotsByTicker` map through, and `swing-discovery/route.ts` now fetches a fresh
last-trade spot (the same `fetchStockLastTrade`/`spotFromLastTradeResult` accessor already used for
organic WATCH tickers) for every carried Legacy ticker before persisting.

**(B)** `legacyCommitCandidatesFromSnapshot` is the new bridge: a Legacy triple whose LIVE-recomputed
`setupState==="TRIGGERED"` and `entryStatus` at `"AT_TRIGGER"`/`"PULLBACK_TO_ENTRY"` — the SAME
observable gate `serving.ts`'s router requires for an organic candidate to reach `COMMIT_NOW` —
becomes a real `SwingCommitCandidate`, built from its own already-materialized dossier/contract (no
new fetch). It is designed to be appended to `discovery.ts`'s existing `commitCandidates` array
before the REAL, UNMODIFIED `computeSwingCommitPlan` runs — same G-S3/G-S4/G-S6/G-S12/G-S14 gates,
same armed-budget + book-percent caps + idempotency, zero duplicated or weakened logic. Deliberately
does NOT invent a "NIGHT HAWK" confluence kind — a Legacy-only candidate carries zero Tier-0
discovery-path provenance unless independently screened this same scan, so G-S6 (>=2/3 independent
kinds) legitimately blocks a Legacy-only signal exactly as it would any other under-corroborated
single-source candidate. `removeCommittedLegacyFromSnapshot` drops a committed ticker from the
persisted WATCH snapshot so it is not also carried forward as a duplicate thesis.

### Evidence

29 new/extended tests in `legacy-confirm-promote.test.ts` (all passing, zero regressions across the
full swing suite, 1572/1572): live re-classification (FORMING→TRIGGERED, FORMING→INVALIDATED,
backward-compatible no-op without `live`), the graduation bridge's filtering, and — the
decisive proof — two **FULL LIFECYCLE** tests that feed a Legacy-sourced candidate into the REAL,
imported, unmodified `computeSwingCommitPlan` (never reimplemented) and confirm: (1) it commits once
TRIGGERED+AT_TRIGGER with a real quote, (2) idempotency still blocks a duplicate open on a second run
against a book that already holds it, (3) G-S6 confluence still blocks it when V2 confluence is
enforced and it carries zero independent corroboration — proving no gate was bypassed or weakened.

Live demonstration against the real board (2026-10-01, see PR body for the full table): DELL/NVDA/
ZS/SHOP's real current prices run through the real classifiers confirm NVDA has genuinely crossed
into `TRIGGERED` (price $228.38 vs trigger $225.07) while production still serves it frozen at
`FORMING` — the exact live bug, reproduced read-only against real market data.

### What was deliberately NOT shipped this PR (flagged for explicit follow-up, not silently done)

The actual live-cron wiring of `legacyCommitCandidatesFromSnapshot`'s output into `discovery.ts`'s
`runSwingDiscoveryScan` commit loop (`computeSwingCommitPlan` call, ~line 1087) requires reordering
`swing-discovery/route.ts` so Legacy carry-forward/live-reclassification runs BEFORE that scan's own
commit loop, not after it (current order, confirmed by reading the route). That is real surgery
inside the live-money cron's control flow and was deliberately left as a precisely-scoped follow-up
rather than rushed through in the same pass — per the operator's own explicit instruction not to
change production behavior until the lifecycle is demonstrated correct, which this PR does via the
pure functions + the full-lifecycle integration tests, without yet touching the cron's call order.
