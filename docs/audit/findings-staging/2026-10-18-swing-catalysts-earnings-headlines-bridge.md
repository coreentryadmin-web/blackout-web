> **kind:** FINDING

## Ask Largo — `catalystsSection` rendered an imminent earnings print and its driving headlines as two unrelated blocks — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings (standing Ask Largo mandate, AGGRESSIVE MODE) |
| **File** | `src/lib/swing/play-brief-intel.ts` (`catalystsSection`) |
| **Status** | FIXED |

**Root cause.** `catalystsSection` builds the "Catalysts & news" block from four independent
`lines[]` entries (earnings date/timing, short-interest stat, raw headline bullets, peers list)
joined with `\n\n` — plain concatenation, no synthesizing sentence between any of them. Flagged
as a design observation on the standing #4076 collaboration thread (comment 6243951905) after a
live sweep found the sharpest real case: **TSLA**, earnings **in 4 days** (afterhours) rendered
directly above four headlines all about the week's Roadster reveal — an obviously connectable
pair ("earnings in 4 days keeps IV/positioning sensitive, and this week's headlines are the likely
driver into it") that instead rendered as two isolated blocks separated by a blank line. This is
the same "bullet-dump, not a narrative" shape the dealer/dark-pool section and cross-desk coaching
already had fixed earlier in the week (per `#4084`'s `tradeManagerNarrativeSection`); this section
was never swept for the same defect.

**Fix.** Hoisted `earningsDaysUntil` out of the earnings block (previously a function-local `d`)
so the headlines block can see it. When earnings falls inside the same ~2-week window
`meridianCatalystSection`'s own "14-day Meridian window" messaging already uses (`earningsSoon =
earningsDaysUntil >= 0 && <= 14`), prepend one synthesizing sentence — `"_That earnings date keeps
IV/positioning sensitive — the headlines below look like the likely driver into it._"` — ahead of
the `**Headlines:**` bullets. The original "Earnings: ..." line is untouched and still renders in
its original position; this only adds a lead-in to the headlines block, never removes or restates
the date. When earnings is null or more than ~2 weeks out, `earningsSoon` is false and the bridge
is a no-op — existing behavior for every other earnings/headline combination is unchanged.

**Evidence.** RED→GREEN: added 3 new tests to `play-brief-intel.test.ts` —
1. `catalystsSection: imminent earnings + headlines get a connecting sentence (live TSLA shape)` —
   asserts the new bridging sentence renders alongside the unchanged earnings line and headlines.
2. `catalystsSection: NO connecting sentence when earnings is well outside the window` — locks in
   the no-op path for a 60-day-out print.
3. `catalystsSection: NO connecting sentence when there is no earnings date at all (regression
   guard)` — locks in the no-op path when `arsenal.earnings` is null.

`git stash` of the source fix (keeping the new tests) reproduced a clean RED (`1 fail`) on test 1
above; restoring the fix brought it back to GREEN. Full `play-brief-intel.test.ts` suite:
261/261 pass post-fix. `tsc --noEmit -p .` clean.

**Blast radius.** Single call site (`buildIntelSections` → `catalystsSection`), single section.
`meridianCatalystSection` (a separate, Meridian-sourced catalyst calendar block two functions
down) has the identical "no connecting sentence" shape and was flagged in the same #4076 comment
as a second, smaller instance — **not fixed here**, left as a follow-up since it is a distinct
function with its own dedup logic against this one's earnings date and deserves its own careful
look rather than a rushed bolt-on in the same PR.

**Why this fix and not an alternative.** Considered restructuring the whole section into a single
narrated paragraph (matching `tradeManagerNarrativeSection`'s full prose treatment) but rejected
it as disproportionate scope for one connective sentence — the existing bullet structure (short
interest, headline list, peers) is otherwise fine and not flagged as a problem; only the
earnings↔headlines pairing lacked connective tissue. A minimal, additive lead-in preserves every
other rendering path byte-for-byte.
