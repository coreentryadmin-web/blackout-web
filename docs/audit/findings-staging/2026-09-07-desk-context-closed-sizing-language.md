> **kind:** `FINDING`

## Ask Largo swing brief: "Desk context" told a CLOSED play to size against "today's setup" — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`play-brief-intel.ts`'s `deskConsensusSection`) |
| **PR** | (pending — `fix/desk-context-closed-framing`) |

### Symptom

Found during the standing Ask Largo monitor cycle (2026-09-07), live-fetching
`GET /api/market/swing/play-brief?playId=SWING:AAPL&positionId=36` (AAPL, LONG, STOPPED
-56.2%, closed 2026-09-04). The "Desk context" section read:

```
Night Hawk's last swing on this name (2026-07-29) is still unresolved — weigh that track
record against today's LONG setup before sizing.
```

"Before sizing" is live, forward-looking guidance — there is no sizing decision left to make on
a position that already exited three days earlier. Same defect class as the two sibling PRs
already open this session:

- `fix/closed-watch-levels-thesis-framing` (#4570) — `watchForSection`'s thesis/gamma-flip lines.
- `fix/closed-vector-desk-live-recommendation` (#4571) — `vectorDeskSection`'s entry/target block.

This is a third, independent instance of the same root shape: a section builder with no `bucket`
awareness, rendering present-tense decision language for a play whose decision already resolved.

### Root cause

`deskConsensusSection(eco, play)` (`src/lib/swing/play-brief-intel.ts`) had no `bucket` parameter
at all — unlike its sibling `watchForSection`, which already branches on
`"watch" | "open" | "closed"`. `buildIntelSections` called it unconditionally for every bucket,
so the hardcoded `"weigh that track record against today's **{direction}** setup before sizing"`
tail rendered identically for a play still being decided and one that closed days ago.

### Fix

`deskConsensusSection(eco, play, bucket = "open")` gains the `bucket` param;
`buildIntelSections` passes it through. For `bucket === "closed"` the tail reframes to
`"for reference against the **{direction}** setup this play traded"` — same NH outcome-history
fact, no forward "before sizing" language. `watch`/`open` behavior is unchanged (default param
preserves every existing caller/test outside this brief).

### Blast radius

Single function, single call site. Reviewed `chartTechnicalsSection`/`wallDynamicsSection`/
`gexPostureSection`/`macroTapeSection` for the same bucket-blind pattern with sizing-style
language — none of them carry it; the pattern was specific to this one section's hardcoded tail.

### Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test --experimental-test-module-mocks src/lib/swing/play-brief-intel.test.ts
```

Two new tests: CLOSED bucket drops "before sizing" and reframes as retrospective reference
(RED before the fix — 1/53 failing via `git stash` on the source file alone, GREEN after);
watch/open buckets unchanged (default param, no regression).

Full `src/lib/swing/*.test.ts`: 822/822 pass. `npx tsc --noEmit`: clean.

### Note

Per `CLAUDE.md`'s self-authored-PR carve-out, this PR holds for Cursor's explicit
`✅ GO AHEAD MERGE` sign-off before merging — not self-merged.
