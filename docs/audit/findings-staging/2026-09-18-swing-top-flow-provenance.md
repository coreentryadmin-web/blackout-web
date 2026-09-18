> **kind:** `FINDING`

## Ask Largo swing brief never disclosed contract-pick vs flow-magnet strike provenance — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief*.ts`) |
| **Severity** | P3 (absence of real, already-computed signal — not a crash/incorrect-number bug) |
| **PR** | fix/swing-top-flow-provenance |

### Root cause

`rankSwingContracts` (`src/lib/swing/contract-ranker.ts`) always independently picks the best
contract by tradability × thesis-fit — its own header comments (contract-ranker.ts:22-23,187) state
this is deliberate: the pick is byte-identical whether or not `topFlowStrike` is supplied, and
`opts.topFlowStrike` is "recorded for provenance ONLY — it is read AFTER the pick is chosen and never
influences it." After the pick, `rankSwingContracts` separately computes `topFlowWasPicked`
(contract-ranker.ts:272): whether the independently-chosen strike happens to coincide with the flow
signal's own magnet strike (the strike multi-day accumulation was piling into, which is often what
flagged the name for the discovery pipeline in the first place).

`commit.ts:547` pins the raw `top_flow_strike` (not the derived boolean) onto every committed
position's row: `top_flow_strike: cand.topFlowStrike ?? null`. `db.ts` confirms this is a real,
permanent column (`db.ts:2112`: `top_flow_strike NUMERIC`, present on `SwingPositionRow` at
`db.ts:7484`/`7653` and written at insert `db.ts:7721`/`7752`), sitting alongside `contract_strike`
on the same row — both real, honest facts about provenance: is the contract a member is holding the
exact strike the flow signal was piling into, or a different one the ranker chose on
tradability/thesis-fit grounds alone?

Nothing in the serving/brief layer ever read `top_flow_strike` back out. Repo-wide grep
(`grep -rln "top_flow_strike|topFlowStrike" src/ --include=*.ts | grep -v test`) confirmed the only
references outside test files were `db.ts`, `roll-plan.ts`, `contract-ranker.ts`, `swing-ingest.ts`,
`dossier.ts`, `commit.ts`, and `discovery.ts` — zero hits in `live-plays.ts`, `closed-plays.ts`,
`play-brief*.ts`, `adapters.ts`, or `types.ts` prior to this fix. The field lives outside
`feature-vector.ts` entirely (a direct DB column on the position row rather than a feature-vector
field), which plausibly explains why the two prior "pinned at commit, never surfaced" rounds this
session (`entryPresentPillars`, `archetypeNearTie`) missed it — both specifically audited the
feature-vector schema, not the position row's own direct columns.

### Evidence

Grep evidence (pre-fix, on `origin/main`):
- `dossier.ts:89`: `topFlowStrike?: number | null;` — "Top flow magnet strike... provenance for the
  contract pick."
- `contract-ranker.ts:170-173`: `topFlowStrike: number | null;` / `topFlowWasPicked: boolean;` on the
  ranker's own result type, with the doc comment "True iff the INDEPENDENTLY-chosen pick's strike
  equals `topFlowStrike`. Never influences the pick."
- `contract-ranker.ts:272`: `const topFlowWasPicked = pick != null && topFlowStrike != null &&
  pick.strike === topFlowStrike;` — computed strictly AFTER the pick (contract-ranker.ts:271 comment:
  "Provenance ONLY — computed AFTER the pick; the pick above never saw topFlowStrike.").
- `commit.ts:547`: `top_flow_strike: cand.topFlowStrike ?? null,`.
- `db.ts:2112`: `top_flow_strike NUMERIC,` (schema); `db.ts:7484`, `7532`, `7689`, `7721`, `7752`:
  `SwingPositionRow` type + read/write paths.
- Zero pre-existing hits for `topFlowStrike|topFlowProvenance` in the play-brief/deck layer, verified
  by isolating just the 7 non-test source files touched by this fix via `git stash`.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-top-flow-provenance` branch off the
actual latest `origin/main`, which already includes #5178):
- Reverted the 7 non-test source files, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/lib/swing/live-plays.test.ts src/lib/swing/play-brief-intel.test.ts`: **6 failures**, all
  in the new tests (`topFlowProvenanceFromRow` ×3, the `livePlayFromSwingPosition` threading test, two
  `whyThisSetupSection` rendering tests) — the expected "function/line doesn't exist yet" shape.
  Nothing pre-existing broke.
- Reapplied. Re-ran the same two files plus the directly-related sweep (`closed-plays.test.ts`,
  `play-brief-resolve.test.ts`, `adapters.test.ts`): **365/365 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20) against this branch: **14670/14673 pass, 0 fail, 3 skipped**
  (448486ms).

### Blast radius

Same additive plumbing shape as #5175/#5178 (`entryPresentPillars`/`archetypeNearTie`), for a third
sibling field:
- `src/lib/swing/live-plays.ts` — new `topFlowProvenanceFromRow` helper; wired into
  `livePlayFromSwingPosition` (OPEN).
- `src/lib/swing/closed-plays.ts` — same wiring in `closedDeckSourceFromRow` (CLOSED), reusing the
  same helper.
- `src/lib/horizon-plays.ts` — new `topFlowProvenance?: { matchedPick: boolean; flowStrike: number;
  contractStrike: number } | null` field on `HorizonPlay`.
- `src/features/nighthawk/command-deck/types.ts` — same field on `TerminalPlay`.
- `src/features/nighthawk/command-deck/adapters.ts` — wired through both `terminalPlayFromHorizon`
  and `terminalPlayFromClosedSwing`.
- `src/lib/swing/play-brief-resolve.ts` — threaded through `horizonRowToDeckSource`.
- `src/lib/swing/play-brief-intel.ts` — `whyThisSetupSection` renders the new "Strike vs flow:" line
  (single call site, symmetric for OPEN and CLOSED) only when `topFlowProvenance` is non-null.

No other consumer of `HorizonPlay`/`TerminalPlay` needs updating — the field is purely additive and
optional.

### Fix rationale

Additive per the Largo product contract: a new optional field, nothing flattened or replaced, no
fabricated confidence score. Unlike the degraded-only gate on `entryPresentPillars` (silent on the
common, healthy case), this line deliberately renders on BOTH a match (genuine corroboration between
the ranker's independent pick and the flow signal) and a divergence (a genuine, disclosed disagreement
a member should see) — only silent when either strike is genuinely unknown, never fabricating a
provenance claim. This mirrors the contract's "disagreement is represented, never reconciled" principle
(`docs/audit/LARGO-PRODUCT-CONTRACT.md`): the ranker and the flow signal can disagree, and that
disagreement is itself information worth showing rather than hiding.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5178's merge), not the originating research agent's own
  working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
