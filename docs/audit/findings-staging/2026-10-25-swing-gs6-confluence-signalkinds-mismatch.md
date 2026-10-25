## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] Served `signalKinds` is lifetime-accreted while G-S6 confluence evaluates only this scan's discovery paths, so a row can show enough kinds to look confluence-clear while still gate-blocked — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, this branch) |
| **Found by** | Adversarially-verified live audit (Ask Largo standing mandate, CLAUDE.md "ASK LARGO × NIGHT HAWK SWINGS" section) |
| **Scope** | `src/lib/swing/discovery.ts`, `src/lib/horizon-plays.ts` |

### Root cause

On the live `GET /api/market/nighthawk/horizons?view=swings` SWING lane, a candidate row's served
`signalKinds` field (e.g. SOXX: `["CATALYST","FLOW","VECTOR"]`, 3 kinds) can appear to satisfy the
archetype's own confluence requirement (`requiredSwingConfluenceCount`, `src/lib/swing/v2/confluence.ts`
— 3 for a standard multi-session archetype like `PULLBACK_CONTINUATION`) while `commitGateBlockedBy`
on the SAME row still shows `"gate:G-S6:confluence"` — with nothing in the payload explaining why,
because the two fields come from genuinely different data sources measuring different things:

1. The REAL input G-S6 (`evaluateConfluenceGate`, `src/lib/swing/v2/gates.ts`) actually evaluates is
   `SwingCommitCandidate.discoveryPaths` (`src/lib/swing/discovery.ts`,
   `discoveryPathsForConfluence(pathsByTicker.get(ticker) ?? [], dossier, {...})`) — strictly THIS
   SCAN's Tier-0 discovery paths, additionally dropping POSITIONING on a direction mismatch. This is
   what `commit.ts`'s `failingSwingCommitGates` call actually passes in, and what
   `stampCommitGateBlocksOnPlays` stamps `commitGateBlockedBy` from.
2. The DISPLAYED `signalKinds` field instead comes from `src/lib/swing/serving-lane.ts`
   (`cand?.signalKinds ?? p.signalKinds` / `obs?.signalKinds ?? p.signalKinds`), sourced from
   `src/lib/swing/accumulation-store.ts` (`signal_kinds: r.signal_kinds ?? []`) — explicitly
   documented in that same file as a LIFETIME-ACCRETED union across every session day the
   ticker/direction/archetype thesis has ever been observed, NOT this-scan-only. That file's own
   header already flagged this exact trap once before (fixed 2026-07-24 for the PERSISTENCE check
   specifically, by introducing `last_session_signal_kinds`/`sessionSignalKinds` as the scan-scoped
   alternative for `hasCorroboration`) — the analogous fix for the G-S6-vs-display pairing was never
   made.

Reusing `last_session_signal_kinds` verbatim for this pairing was considered and rejected: it is
accreted from the same per-scan `pathsByTicker` the gate reads, but — unlike
`discoveryPathsForConfluence` — it does NOT drop a POSITIONING path on a direction mismatch (confirmed
in `discoveryPathsForConfluence`'s own existing test, "drops POSITIONING when origin direction
disagrees with dossier (Q5)"), so it can overcount relative to what G-S6 actually evaluates. The fix
instead stamps the EXACT value the gate evaluated, not a close proxy.

### Evidence

RED→GREEN (`src/lib/swing/discovery.test.ts`): a new fixture matching the live SOXX shape — archetype
`PULLBACK_CONTINUATION` (`requiredSwingConfluenceCount` returns 3), lifetime `signalKinds` carrying 3
kinds (`CATALYST`/`FLOW`/`VECTOR`, satisfying the required count on its face) and
`commitGateBlockedBy: ["gate:G-S6:confluence"]` already stamped, but the scan's real
`SwingCommitCandidate.discoveryPaths` carrying only `["FLOW"]` — asserts the new field reflects the
scan-scoped count (1) that actually explains the live block, while the existing lifetime `signalKinds`
is left untouched. Failed pre-fix (`stampScanSignalKindsOnPlays` did not exist — import/reference
error, both new tests failed) with the source reverted to `origin/main` and only the test file
carrying the new cases; passed post-fix. A second new test proves the field stays absent (never
fabricated) when no commit candidate exists for a play this scan. Full `discovery.test.ts` (33/33),
`v2/gates.test.ts`, `v2/confluence.test.ts`, `commit.test.ts`, `serving-lane.test.ts`, and
`horizon-plays.test.ts` all pass post-fix; `tsc --noEmit` clean.

### Blast radius

Single new field, additive only — no other call site reads `discoveryPaths`/`signalKinds` in a way
this touches. `stampScanSignalKindsOnPlays` is joined by the identical thesis key
(`swingThesisKey(ticker, direction, archetype)`) `stampCommitGateBlocksOnPlays` already uses, so the
two stamps always describe the same play and can never disagree about which row they annotate.
`discoverSwingFromPersisted` (`serving-lane.ts`) and `enrichPlay` both spread the play object
(`{...play, ...}` / `{...p, ...}`) rather than reconstructing an explicit field list, so the new field
passes through the existing persisted-snapshot → serving-lane → horizons-route pipeline unchanged,
the same mechanism that already carries `commitGateBlockedBy` end to end. The existing `signalKinds`
field is untouched — no existing consumer's behavior changes.

### Fix rationale

Added `HorizonPlay.thisScanSignalKinds` (additive — the existing `signalKinds` field is kept
unchanged for any other consumer) and a new `stampScanSignalKindsOnPlays(plays, candidates)` in
`discovery.ts`, mirroring `stampCommitGateBlocksOnPlays`'s existing thesis-keyed join exactly. It
reads `SwingCommitCandidate.discoveryPaths` — the literal value already computed for, and passed into,
G-S6 — rather than re-deriving or approximating it, so the two can never drift apart. Wired at the
same call site `stampCommitGateBlocksOnPlays` already runs from (inside `if (deps.insertPosition)`,
gated on `engineV2 && playSet.SWING.length > 0`), using the same `commitCandidates` array already
built for `computeSwingCommitPlan` (including any Legacy-bridge-appended candidates). No gate
evaluation logic changed — G-S6 was already evaluating correctly against its real input; this closes
a disclosure/visibility gap only.

### Deliberately left unchanged

- `evaluateConfluenceGate`/`failingSwingCommitGates`/G-S6 itself — unchanged, already correct.
- The existing lifetime-accreted `signalKinds` field and every current reader of it.
- The known, separate gap where `last_session_signal_kinds` (persistence check) and
  `discoveryPathsForConfluence` (G-S6) can themselves disagree on a POSITIONING-direction-mismatch —
  pre-existing, orthogonal to this fix, and not touched here.
- `legacyCommitCandidatesFromSnapshot`'s raw (non-`discoveryPathsForConfluence`-filtered) assembly of
  `discoveryPaths` for Legacy-bridge candidates — a separate, already-disclosed gap in that file's own
  header, out of scope for this surgical fix.
