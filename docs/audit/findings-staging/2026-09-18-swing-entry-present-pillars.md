# Ask Largo swing brief never disclosed how thin the evidence read was at commit, despite the identical fact already surfacing pre-entry on WATCH candidates

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `whyThisSetupSection` (`src/lib/swing/play-brief-intel.ts`), plumbing across `live-plays.ts`/`closed-plays.ts`/`horizon-plays.ts`/command-deck types+adapters/`play-brief-resolve.ts` |
| **Severity** | P3 (member-facing narrative quality / Largo product-contract historical-context + evidence points) |
| **Status** | FIXED — `fix/swing-entry-present-pillars` |

## Root cause

`dossier.ts`'s `SwingDossier.dataQuality` (`presentPillars`/`degraded`, computed honestly at commit
from the 7 evidence pillars) gets pinned into every committed position's
`feature_vector.present_pillars`/`dq_degraded` columns (`feature-vector.ts`, wired at commit time and
echoed on every later `manage-sync.ts` snapshot) — but was never read back out anywhere in the
serving/brief layer for an already-committed OPEN or CLOSED position.

A pre-entry WATCH candidate's identical read already surfaces as a "thin read — N/7 pillars grounded"
thesis-health note the instant it degrades (`serving-ingest.ts`'s `swingServingMetaFromDossier`) — a
member sees it before committing. Once committed, that same fact — how thin the evidence actually was
when real capital went in — silently disappears: `livePlayFromSwingPosition`/`closedDeckSourceFromRow`
both already read `row.feature_vector.evidence_score` for the score number, but neither ever read the
two sibling columns sitting right next to it.

## Evidence

Confirmed `present_pillars`/`dq_degraded` are real, already-pinned DB columns
(`feature-vector.ts` lines 62-63, 131-132, 199-200, 234), `dossier.ts`'s `dataQuality.degraded`
threshold (`presentPillars < MIN_PRESENT_PILLARS || missing.includes(CRITICAL_PILLAR)`, line 173),
and `serving-ingest.ts`'s live "thin read — N/7 pillars grounded" note (line 204) — the exact same
underlying fact, already disclosed pre-entry, silently dropped post-commit. Same "structural absence,
not staleness gap" shape `live-plays.ts`'s own comment already names for the
`entryTriggerUnderlyingPx`/`committedAt`/`firstSeenAt` fields it was wired in to fix.

## Blast radius

Additive field threaded through the full pipeline: `live-plays.ts` (new pure helper
`entryPresentPillarsFromFeatureVector`, wired into `livePlayFromSwingPosition`), `closed-plays.ts`
(same helper, `closedDeckSourceFromRow`), `horizon-plays.ts` / `command-deck/types.ts` /
`command-deck/adapters.ts` / `play-brief-resolve.ts` (plumbing `entryPresentPillars` through
`HorizonPlay` → `HorizonDeckSource` → `TerminalPlay`), `play-brief-intel.ts`'s `whyThisSetupSection`
(the render line). No existing behavior changed — every new field is optional and additive.

## Fix rationale

Deliberately returns null (never surfaced) unless the read was actually thin at commit — same
threshold the WATCH-lane note itself gates on — so a normal, well-grounded entry renders nothing
extra, mirroring the pre-entry note's own "only when it matters" discipline rather than cluttering
every brief with a number that is unremarkable the overwhelming majority of the time.

## Verification

- Independent RED→GREEN (reverted only the 7 source files, kept the tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/live-plays.test.ts
  src/lib/swing/play-brief-intel.test.ts` — 6/180 failed with source reverted, exactly the new
  assertions. Reapplied — 180/180 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/live-plays.test.ts
  src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts
  src/lib/swing/play-brief-resolve.test.ts src/lib/swing/closed-plays.test.ts
  src/features/nighthawk/command-deck/adapters.test.ts` — 429/429 pass.
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` (Node 20) — pending in background at time of PR open; see PR for final count.
