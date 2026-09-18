> **kind:** `FINDING`

## Ask Largo swing brief's new archetype near-tie line fabricated a "winning archetype" claim for a position the classifier never classified — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — fabricated narrative claim (Largo C6 absence-over-fabrication violation), not a live-trading-path change |
| **Component** | `src/lib/swing/live-plays.ts` (`archetypeNearTieFromFeatureVector`), `src/lib/swing/play-brief-intel.ts` (`whyThisSetupSection`) |
| **Found by** | NIGHT HAWK SWINGS standing audit lane, peer review of PR #5178 (merged 39b61f574, same-day parallel-session PR), 2026-09-18 |

### Root cause

PR #5178 (this session, ~07:00 UTC) added a "Classification: near-tie at entry" line to `whyThisSetupSection`, reading the entry-time archetype classifier's own decisiveness margin back off the pinned `feature_vector.classification_margin`/`.secondary` columns. The render code was:

```ts
if (play.archetypeNearTie) {
  lines.push(
    `**Classification:** near-tie at entry — **${whyArchetypeLabel ?? "the winning archetype"}** beat ` +
      `**${play.archetypeNearTie.secondaryLabel}** by only ${play.archetypeNearTie.marginPct} pts.`,
  );
}
```

`whyArchetypeLabel` is null whenever `play.archetype` is null — which is a real, reachable state: `classifyArchetype`'s thin-evidence branch (`inputCount < MIN_INPUTS_PRESENT || winnerFit < EVIDENCE_FLOOR`, `archetype.ts`) returns `archetype: null` while still computing and returning a real `margin` (`topFit - secondFit`, computed unconditionally before the thin-evidence check). `commit.ts` pins `classificationMargin`/`archetypeSecondary` onto the row's `feature_vector` unconditionally too — never gated on `archetype` being non-null.

Worse, `classificationMetaFromVerdict`'s own reshaping (`const secondary = ranked.filter((a) => a !== v.archetype);`) becomes a no-op when `v.archetype` is `null` — nothing gets excluded, so `secondary` is the FULL ranked list, and `secondary[0]` is the *would-be top-fit archetype itself*, not a genuine runner-up. Combined with the `?? "the winning archetype"` fallback, a thin-evidence, genuinely-unclassified position whose margin happened to fall inside the near-tie band would render:

> **Classification:** near-tie at entry — **the winning archetype** beat **Breakout continuation** by only 3 pts.

with no preceding "**Archetype:**" line anywhere in the document to anchor "the winning archetype" — a fabricated claim that a decisive classification occurred, for a position the classifier explicitly never classified. This is the exact absence-over-fabrication violation PR #5178's own doc comments state the feature is designed to avoid.

### Evidence

Confirmed reachable, not theoretical: NN (positionId 32, a real CLOSED position examined earlier this session) carries `archetype: null` in `GET /api/market/swing/record`'s `closedDeck`. Traced `commit.ts:595-621`/`682-707` (`buildCommitInsert`/`buildShadowInsert`) — both write `feature_vector: buildSwingFeatureVector({ archetype: cand.archetype, ..., classificationMargin: cand.classificationMargin ?? null, archetypeSecondary: cand.archetypeSecondary ?? null, ... })`, with no conditional gating between `archetype` and the classification-metadata fields. Traced `archetype.ts:181-216` (`classifyArchetype`): `margin` is computed at line 184, before the thin-evidence `archetype: null` return branch at line 197-204 — confirming a null-archetype row can carry a real, potentially near-tie-range margin. Traced `archetype.ts:255` (`classificationMetaFromVerdict`): `secondary = ranked.filter((a) => a !== v.archetype)` — verified this is a true no-op filter when `v.archetype` is `null` (nothing equals `null` except `null` itself, and `ranked` never contains `null`).

### Blast radius

Both call sites of `archetypeNearTieFromFeatureVector` (OPEN via `live-plays.ts`'s `livePlayFromSwingPosition`, CLOSED via `closed-plays.ts`'s `closedDeckSourceFromRow`) were affected identically, since both feed the same helper. Display-only — no gate, scoring, or exit-management logic reads `archetypeNearTie`.

### Fix rationale

Two-layer fix, both minimal:
1. **Source layer** (`archetypeNearTieFromFeatureVector`, `live-plays.ts`): added a guard requiring `featureVector.archetype` to be a real non-empty string before computing anything else. `feature_vector.archetype` mirrors the same row-level `archetype` DB column `play.archetype` is read from (both written from the identical `cand.archetype` value in the same commit insert), so this is a sound proxy without threading `play.archetype` through this feature-vector-only function's signature. This closes the gap for every current and future consumer of the helper, not just `whyThisSetupSection`.
2. **Render layer** (`whyThisSetupSection`, `play-brief-intel.ts`): changed `if (play.archetypeNearTie)` to `if (play.archetypeNearTie && whyArchetypeLabel)`, and dropped the `?? "the winning archetype"` fallback entirely (now unreachable, but removed rather than left as dead code implying the case is still expected). Defense-in-depth: even if a future caller ever constructs a `TerminalPlay` with `archetypeNearTie` set but no real `archetype` (bypassing the source-layer guard), this line still cannot fabricate the claim.

### Test

- `src/lib/swing/live-plays.test.ts`: new test `"archetypeNearTieFromFeatureVector: never surfaces a runner-up when the entry was itself unclassified (archetype: null)"` (2 assertions: explicit `archetype: null` and `archetype` omitted entirely) plus a new end-to-end test `"livePlayFromSwingPosition: never threads a near-tie when the entry was itself unclassified (real NN:32-shaped row, archetype: null)"`. Also updated the 4 pre-existing `archetypeNearTieFromFeatureVector` test fixtures (from PR #5178) to include a real `archetype` field, since production feature vectors always carry one alongside `classification_margin`/`secondary` — the original fixtures were incomplete, not representative.
- `src/lib/swing/play-brief-intel.test.ts`: new test `"whyThisSetupSection: never fabricates the near-tie line when the entry itself was unclassified (archetype null), even if archetypeNearTie is somehow set"`.

Deliberate-break RED→GREEN proof via `git stash`/`git stash pop` on the two source files only (test files kept in place): reverting dropped exactly 3/189 tests (the 3 new positive-assertion tests across both files — the fixture-only edits to the 4 pre-existing tests didn't change their outcome since the source's old behavior never checked `archetype` either way), diff-verified byte-identical restore. `npx tsc --noEmit -p .` clean (Node 20). Full relevant scope (`live-plays.test.ts` + `play-brief-intel.test.ts` + `closed-plays.test.ts` + `play-brief-resolve.test.ts` + command-deck `adapters.test.ts`): 361/361 pass. Full `npm test` (Node 20), pre-merge: 14663/14666 pass, 0 fail, 3 pre-existing skips.

**Post-merge update:** PR #5180 (`topFlowProvenance`, same-day parallel session) merged first and touched the same three files, producing a real merge conflict (`MARKET-OPEN-VALIDATION.md`'s #269 slot, both PRs picked it independently; an adjacent-insertion conflict in `play-brief-intel.test.ts`). Resolved: kept both `MARKET-OPEN-VALIDATION.md` entries (renumbered this one #269→#270), kept both test blocks. Re-validated post-merge: full relevant scope (370 tests) pass, `tsc` clean, full `npm test` (Node 20): 14690/14693 pass, 0 fail, 3 pre-existing skips.
