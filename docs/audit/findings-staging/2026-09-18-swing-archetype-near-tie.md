> **kind:** `FINDING`

## Ask Largo swing brief silently drops entry-time archetype near-tie calls — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief*.ts`) |
| **Severity** | P3 (absence of real, already-computed signal — not a crash/incorrect-number bug) |
| **PR** | fix/swing-archetype-near-tie |

### Root cause

`classifyArchetype` (`src/lib/swing/archetype.ts`) always computes a decisiveness `margin`
(`topFit − secondFit`, `ArchetypeVerdict.margin`) alongside the winning archetype label. Its own
tie-break logic treats two fits within `MARGIN_EPS = 0.05` (archetype.ts:105) as a near-coin-flip
resolved only by `ARCHETYPE_PRIORITY` (most-specific-first), not by additional evidence
(archetype.ts:104-216).

`classificationMetaFromVerdict` (archetype.ts:221-257) reshapes that verdict into
`{ primary, secondary, scores, margin }` and pins it onto every committed position's feature row —
`commit.ts:611-613` and `commit.ts:682-684` write `archetypeSecondary`/`archetypeScores`/
`classificationMargin` from `cand.*`, and `discovery.ts:1009` computes that `classMeta` via
`classificationMetaFromVerdict(d.archetype)`. `feature-vector.ts` persists these as
`feature_vector.secondary` (`string[]`, feature-vector.ts:110) and
`feature_vector.classification_margin` (`number | null`, feature-vector.ts:114) — sitting directly
next to `evidence_score` and `present_pillars`, both of which the play-brief layer already reads off
this same pinned feature vector (the latter as of PR #5175, this session).

Nothing in the serving/brief layer ever read `classification_margin`/`secondary` back out. Grep
confirmed zero hits for `archetypeSecondary|classificationMargin|archetypeScores` anywhere under
`src/lib/swing/play-brief*.ts`, `src/lib/horizon-plays.ts`, or
`src/features/nighthawk/command-deck/*.ts` prior to this fix. A member reading a play-brief sees
only `**Archetype:** Breakout continuation` with no signal that the classifier's own math called this
a near-tie against, e.g., Pullback continuation — which matters specifically because
`feature-vector.ts`'s own header states scoring/gating/calibration all key off the single pinned
`archetype`/`primary` field only, so a razor-thin classification call silently drives real downstream
weight with no visibility into how close it was.

### Evidence

Grep evidence (pre-fix, on `origin/main`):
- `archetype.ts:105`: `const MARGIN_EPS = 0.05;`
- `archetype.ts:185`: `const margin = round2(topFit - secondFit);`
- `commit.ts:611-613` / `commit.ts:682-684`: `archetypeSecondary`/`archetypeScores`/
  `classificationMargin` written from `cand.*` at both commit call sites.
- `discovery.ts:1009`: `const classMeta = d ? classificationMetaFromVerdict(d.archetype) : null;`
- `feature-vector.ts:110`: `secondary: string[];` / `feature-vector.ts:114`:
  `classification_margin: number | null;`
- `grep -rn "archetypeSecondary\|classificationMargin\|archetypeNearTie" src/lib/swing/play-brief*.ts
  src/lib/horizon-plays.ts src/features/nighthawk/command-deck/*.ts` on the pre-fix source files
  (verified via `git stash` isolating only the 7 non-test source files touched by this fix): **zero
  hits**.

RED→GREEN proof (independently reproduced from scratch on a fresh `fix/swing-archetype-near-tie`
branch off the actual latest `origin/main`, not trusting the originating research pass's own claim):
- Reverted the 7 non-test source files (`git stash push` on just those paths), kept the new/extended
  test files. `npx tsx --experimental-test-module-mocks --test src/lib/swing/live-plays.test.ts
  src/lib/swing/play-brief-intel.test.ts`: **5 failures**, all in the new tests
  (`archetypeNearTieFromFeatureVector` ×3, the `livePlayFromSwingPosition` threading test, the
  `whyThisSetupSection` rendering test) — `TypeError`/`undefined`, the expected "function doesn't
  exist yet" shape. Nothing pre-existing broke.
- Reapplied (`git stash pop`). Re-ran the same two files plus the directly-related sweep
  (`closed-plays.test.ts`, `play-brief-resolve.test.ts`, `adapters.test.ts`): **358/358 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20, `/opt/node20/bin`) against this branch: **14652/14655 pass, 0 fail,
  3 skipped** (434514ms).

### Blast radius

Same additive shape as PR #5175 (`entryPresentPillars`) — touches the identical plumbing chain for a
sibling field:
- `src/lib/swing/live-plays.ts` — new `archetypeNearTieFromFeatureVector` helper; wired into
  `livePlayFromSwingPosition` (OPEN).
- `src/lib/swing/closed-plays.ts` — same wiring in `closedDeckSourceFromRow` (CLOSED).
- `src/lib/horizon-plays.ts` — new `archetypeNearTie?: { secondaryLabel: string; marginPct: number }
  | null` field on `HorizonPlay`.
- `src/features/nighthawk/command-deck/types.ts` — same field on `TerminalPlay`.
- `src/features/nighthawk/command-deck/adapters.ts` — wired through both `terminalPlayFromHorizon`
  and `terminalPlayFromClosedSwing`.
- `src/lib/swing/play-brief-resolve.ts` — threaded through `horizonRowToDeckSource`.
- `src/lib/swing/play-brief-intel.ts` — `whyThisSetupSection` renders the new line only when
  `archetypeNearTie` is non-null.

No other consumer reads `HorizonPlay`/`TerminalPlay` in a way that would need updating — the field is
purely additive and optional, consistent with every other prior fix in this chain this session.

### Fix rationale

Additive per the Largo product contract (`docs/audit/LARGO-PRODUCT-CONTRACT.md`): a new optional
field, nothing flattened or replaced, no fabricated confidence score — the line is gated on the
classifier's *own* near-tie threshold (`MARGIN_EPS`, mirrored locally as `ARCHETYPE_NEAR_TIE_MARGIN`
since the source constant is module-private to `archetype.ts` and `taxonomy.ts` — the shared,
cycle-free import surface every swing module uses — deliberately carries no scoring logic per its own
header), so a decisive classification (the overwhelming common case) renders nothing extra. This is
the same "only when it matters" discipline as `entryPresentPillarsFromFeatureVector` (PR #5175),
applied to a different pinned-but-unsurfaced feature-vector field found via a deliberately different
research angle this round (reading `archetype.ts`/`commit.ts`/`discovery.ts`, upstream files not yet
audited by any prior Ask Largo round this session) rather than re-running a prior round's methodology.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (not the originating research agent's own working-tree state) — diff applied cleanly,
  RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
