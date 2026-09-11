> **kind:** FINDING

## Swing "Industry read" — industry-group RS facts computed and thrown away, never reach the brief — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product enhancement — richer, not just correct) |
| **Area** | Night Hawk Swings / Ask Largo play-brief |
| **Found by** | Claude, PR #4076 collaboration thread, comment 5627569075 (2026-09-11 cycle) |

### Root cause

`src/lib/swing/industry-group-rs.ts`'s `industryGroupRs01()` resolves each swing name's benchmark
(industry ETF via SIC code, or sector ETF fallback — `resolveGroupBenchmark`) and computes the
name's direction-signed 10-session return vs that benchmark's return, purely so the archetype
classifier can score the SECTOR_ROTATION fit (`sectorLeadership01`). `swing-ingest.ts` called it and
kept only the 0-1 score — the underlying facts that produced it (which ETF/label the name
benchmarks against, the name's actual %-return, the group's actual %-return) were computed inline
and discarded. Nothing downstream — not `archetypeExtras`, not `entry_context`, not the play-brief
— ever saw them. A member reading "Why this setup" on a SECTOR_ROTATION play saw only
"Structure +12.6 pts" — a bare pillar score, not the concrete, checkable fact ("INTC is lagging
SOXX by 4.2% over 10 sessions") a trader would actually want before sizing a group-rotation thesis.

Confirmed via `grep -rn "sectorLeadership\|industry.group\|groupBenchmark\|SECTOR_ROTATION"
src/lib/swing/play-brief*.ts` returning one hit — a comment noting the score folds into the
"structure" pillar bucket, nothing naming the actual benchmark or comparison. Live-checked two real
briefs (AAPL closed/PULLBACK_CONTINUATION, INTC watch/EVENT_DRIVEN) before the fix — neither
mentioned a leading/lagging ETF anywhere.

### Fix

Additive end-to-end thread, no existing behavior changed:
1. `industry-group-rs.ts` — new pure `industryGroupRsFacts()` alongside (not replacing)
   `industryGroupRs01()`: same benchmark/closes inputs, returns
   `{benchmarkEtf, benchmarkLabel, kind, nameReturnPct, groupReturnPct, deltaPct}` or null on the
   exact same absence conditions (no benchmark / thin history). NOT direction-signed — `deltaPct`
   is the raw name-vs-group spread so "leading/lagging" reads the same sense for a long or a short.
2. `swing-ingest.ts` computes the facts alongside the existing score and carries them on the
   dossier itself (`sectorLeadershipFacts`) — NOT through `archetypeExtras`/`ArchetypeInputs`,
   which only feed the classifier's fit calc and are discarded after classification.
3. `dossier.ts` (`SwingDossierInput`/`SwingDossier`) carries the field through verbatim.
4. `serving-ingest.ts`'s `swingServingMetaFromDossier` echoes it into `SwingServingMeta`;
   `serving-lane.ts`'s `enrichPlay` (WATCH) and `attachThesisExplanation` (live/committed) merge it
   onto `HorizonPlay`, same pattern as the existing `factors`/`regime` fields.
5. `horizon-plays.ts` (`HorizonPlay`), `play-brief-resolve.ts` (`horizonRowToDeckSource`),
   `adapters.ts`/`types.ts` (`HorizonDeckSource`/`TerminalPlay`) thread it through to the brief —
   same shape carried at each hop, inlined (not a shared import) to match how `factors`/`regime`
   already cross that boundary.
6. `play-brief-intel.ts`'s `whyThisSetupSection` renders one line when present: `**Industry read:**
   leading/lagging **{label}** ({ETF}) by {pct}% over 10 sessions ({name%} vs {group%}).` Null stays
   omitted — honest absence, never fabricated, matching the module's existing discipline.

### Scope disclosed, not covered by this PR

Wired for the **WATCH and OPEN/HOLD/TRIM** buckets (both resolve through the live/re-run dossier via
`discoverSwingFromPersisted()`). The **CLOSED** bucket resolves via `entry_context` persisted at
commit (`closed-plays.ts` reads `row.entry_context?.cortex` the same way Cortex is pinned) and this
fix does not persist `sectorLeadershipFacts` into `entry_context` — a closed swing brief will not
show the Industry read line. Follow-up: pin the facts into `entry_context` at commit (`commit.ts`)
the same way `cortex` is pinned, and read them back in `closed-plays.ts`, if CLOSED-bucket coverage
is wanted.

### Evidence

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/industry-group-rs.test.ts` — 12/12
  pass (3 new tests covering the facts function: recovers benchmark/returns, negative delta reads
  LAGGING, honest null on no-benchmark/thin-history).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts
  src/features/nighthawk/command-deck/*.test.ts` — 1329/1329 pass (full swing + command-deck suite,
  no regressions from the threaded field).
- `npx tsc --noEmit -p .` — clean.
