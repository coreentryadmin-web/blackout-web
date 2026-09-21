## Night Hawk Legacy — data-collection additions for future Winner-DNA analysis: DTE, explicit setup_type, raw pre-selection features, verified forward-grading coverage, and geometry/premium_cap capture — SHIPPED (INSTRUMENTATION ONLY)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/features/nighthawk/lib/deterministic-edition.ts`, `scorer.ts`, `edition-builder.ts`, `claude-edition.ts`, `edition-quality.ts`, `types.ts`; new `setup-classification.ts`, `raw-feature-snapshot.ts` |
| **Status** | SHIPPED — observational only, zero change to production scoring/ranking/selection/publishing |
| **Severity** | N/A — this is new capability, not a bug fix, except for one real gap it surfaces (see below) |
| **Found via** | operator directive: close the data-collection gaps needed before any future Winner-DNA / feature-attribution work can be built on clean historical data |

### What shipped

**D1 — Persist actual DTE.** Contract selection (`pickChainContract`) happens inside
`buildDeterministicEditionPlays`'s main loop, strictly AFTER `scored`/`rank_governor` snapshot
capture and STAGE-2/STAGE-4b rejections — so DTE can only ever be non-null for `rank_final` rows
and rejections that occur after a contract was picked. A new `PlaybookPlay.dte` field is computed
once in `buildPlay()` (and `buildRescuePlays()`) via the already-proven `calendarDteBetween`
(`src/lib/zerodte/board.ts`, reused rather than reinvented — already used by 3 other lanes) and
flows naturally through grounding/merge to `rank_final`/STAGE-6-rejected snapshot rows. Stays
honestly `null` (never a fabricated same-day) for `discovery`/`scored`/`rank_governor`/
`confluence_gate`/`cross_edition_governor` rows, which structurally never had a contract selected.

**D2 — Persist explicit `setup_type`.** New `setup-classification.ts`: a deterministic, rule-based
classifier (`classifySetupType`) labeling a candidate by whichever scoring dimension dominates —
never a learned/ML label, stamped once at capture time rather than approximated later. Wired into
`scoredCandidateSnapshotPayload` (covers `scored`/`rank_governor`/governor-rejected rows) and
directly into `buildRankFinalSnapshotRows`/`buildStageRejectionSnapshotRows` (which read it
straight off the play's own `factor_breakdown` — already persisted for the member-facing factor
bars — or the passed-in `ScoredCandidate`, whichever is available). `rank_final`/`rejected` schema
bumped v2→v3 for these two additive fields; existing v2 tests updated to v3 with new assertions for
the additive fields, not just a version-number bump.

**D3 — Preserve raw pre-selection features.** New `raw-feature-snapshot.ts`: pure
`buildRawFeatureSnapshot(dossier)` reading fields already fully populated on `TickerDossier` at
scoring time (RVOL/RSI/ATR/VWAP/EMA stack, gamma/dealer positioning, dark-pool premium/bias, skew,
IV rank, short-interest, analyst PT, sector) — no new fetch. Array-shaped raw feeds (congress
trades, institutional activity, OI-change rows, catalysts) are captured as COUNTS, not full
payloads, to keep the snapshot row bounded. Wired additively into `buildScoringStageSnapshotRows`/
`recordScoringStageSnapshots` via a new optional `dossierMap` parameter (default `{}`, so every
existing call site/test without it is unaffected) at both existing `scored`/`rank_governor`
capture call sites in `edition-builder.ts`.

**D4 — Confirmed rejected candidates already get forward-graded.** Verified directly against
`candidate-forward-grade.ts`/`db.ts`: the grading query has no `stage`/`rejection_reason` filter
at all — it already grades every row for a `(edition_for, ticker)` identically. No code change
needed; added a regression test locking this in (source-inspects the query's WHERE clause for the
absence of any stage/reason restriction, and the call site for the absence of any filtering
option).

**D4-extra — geometry/premium_cap main-loop rejection capture (operator-approved, INSTRUMENTATION
ONLY).** Investigating D1 surfaced a real gap: per-candidate `geometry`/`premium_cap` drops inside
the main contract-selection loop were only aggregate-counted, never persisted as rows — invisible
to forward-grading and any future analysis. Fixed by adding a `.push()` beside each existing,
UNMODIFIED `continue` (never touching the branch condition), collected into a new, unconditionally-
computed `mainLoopRejected` return field on `buildDeterministicEditionPlays`. `illiquid_strike` and
`ungrounded` were confirmed genuinely dead code (nothing constructs them in production) and were
correctly left untouched — nothing to wire without inventing new logic.

Merging these rejections into the existing `stageRejected` capture pipeline (already fully wired
end-to-end for audit trail + `nighthawk_candidate_snapshot`) is gated behind a new flag,
`NIGHTHAWK_MAIN_LOOP_REJECTION_CAPTURE_ENABLED` (default OFF, in `edition-quality.ts` alongside
every other `NH_LEGACY_*` flag). Critically, `buildDeterministicEditionPlays` itself **never reads
this flag** — it always computes `mainLoopRejected` unconditionally — so `plays`/`funnel`/scores/
ordering are structurally, provably independent of the flag; only whether `claude-edition.ts`
merges the array into `stageRejected` for durable capture depends on it.

### A real gap this surfaced, disclosed rather than silently worked around

Building D1's DTE capture required tracing exactly where `pickChainContract`'s strict (non-
caveated) pool enforces the premium cap. That trace showed the main-loop `premium_cap` rejection
branch (`contract && !contract.caveat && play.premium_cap_ok === false`) is **also structurally
unreachable today**: `pickChainContract`'s strict pool already filters by `premium <=
MAX_OPTION_PREMIUM_PER_SHARE` before returning a non-caveated contract, and `applyPremiumCapToPlay`
reads that exact same `contract.premium` value straight through — so a non-caveated contract can
never fail the cap check downstream. This is the same shape as the already-known
`illiquid_strike`/`ungrounded` dead-code gap, just for a third reason. The instrumentation added
here is still correct and harmless (it will start producing real rows the moment this invariant
ever changes, e.g. if the two premium calculations diverge in a future edit), but is disclosed
honestly as currently inert rather than claimed to be exercised in production today. The
`geometry` branch, by contrast, is genuinely reachable (`buildPlay`'s option-coherence target push
can invert R:R/band-containment in principle) though not organically triggered by any fixture in
this PR's test suite within the time budget — proven instead by direct source inspection plus a
behavioral proof that the flag cannot affect `buildDeterministicEditionPlays`'s output.

### Evidence

- `git diff` on `scorer.ts`/`deterministic-edition.ts`: every change is additive (new fields, new
  imports, a `.push()` beside an unmodified `continue`) — no existing conditional/branch logic
  touched.
- New tests: `setup-classification.test.ts` (8), `raw-feature-snapshot.test.ts` (8),
  `claude-edition.test.ts` (4, new file), plus additions to `deterministic-edition.test.ts` (6),
  `edition-quality.test.ts` (2), `candidate-forward-grade.test.ts` (2), and updated/extended
  assertions in `edition-builder-scoring-snapshot.test.ts` (schema v2→v3, plus 4 new tests for the
  additive fields).
- A dedicated behavioral proof: `buildDeterministicEditionPlays` run twice, flag unset/0 vs `"1"`
  — `plays`/`funnel` asserted byte-identical (`deepEqual`) either way, backed by a source-inspection
  test confirming the flag string never appears in `deterministic-edition.ts` at all.
- Full `src/features/nighthawk/**` suite: **1829/1829 pass**. `tsc --noEmit`: clean. `next lint`:
  no warnings.

### What's still open

Real `raw_features`/`setup_type`/`dte` history needs to accumulate across real editions before any
Winner-DNA analysis can be built on it — per standing operator instruction, no such analysis starts
from this (currently near-zero) sample. `NIGHTHAWK_MAIN_LOOP_REJECTION_CAPTURE_ENABLED` stays OFF
by default; flipping it on (to start actually capturing these rows) is a separate, later decision.
