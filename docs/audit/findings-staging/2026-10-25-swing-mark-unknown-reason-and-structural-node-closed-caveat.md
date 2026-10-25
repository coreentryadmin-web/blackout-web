> **kind:** FINDING

## Ask Largo swing play-brief: two more stale/absence-disclosure gaps (mark-unknown reason text, structural-node market-closed caveat) — FIXED

| **Status** | FIXED (PR #TBD, this branch) |

Two independent findings from the same 12-ticker parallel Largo play-brief audit (SNOW, RDW),
both adversarially verified unanimously (3/3 skeptics, 0 refuted each), bundled into one PR per
the established precedent (same "disclosure consistency" bug class as PR #6726, different files).

### Finding 1 (SNOW): `collectOptionMarkStalenessAbsence` mislabels a genuinely-unknown mark as a real-but-untimestamped one

**Root cause:** `collectOptionMarkStalenessAbsence()` (`src/lib/swing/play-brief-absence.ts`)
returned the reason `"sync quote without freshness timestamp"` unconditionally whenever
`play.markIsSync === true` — wording that asserts a real quote VALUE exists, just untimestamped.
That's true for the ordinary banger/native-lane race this branch was built for, but not when
`optionMarkGenuinelyUnknown(play)` also holds — the true entry-fallback case (no live tick has
ever landed, `play.pnlPct` itself is `null`) that `pnlSection`'s own Mark line and
`dataFreshnessSection` already render as "Mark: unknown … no live price yet" / "P&L is not yet
known."

**Evidence:** SWING:SNOW:2105 — `unavailableSources`/confidence/footer all said "sync quote
without freshness timestamp" (implying a real, just-unstamped price) while the SAME brief's
Position and Data-freshness sections correctly said no price exists at all.

**Fix:** added a more specific branch, checked first, returning an honest
`"no live price yet — sync quote, no real quote value has ever landed"` reason (with its own
`what_is_missing`) when `optionMarkGenuinelyUnknown(play)` holds; falls through to the existing
generic reason otherwise.

**Regression caught before it shipped:** `dataHonestyCoaching()`
(`src/lib/swing/play-brief-narrative-coaching.ts`) pattern-matched the OLD single reason string
exactly (`markAbsence.reason === "sync quote without freshness timestamp"`). Since
`optionMarkGenuinelyUnknown(play)` reduces to exactly `play.pnlPct == null` inside this function's
`markIsSync === true` branch (every other input is already pinned true at that point), the new
reason string would have fallen to that `if`'s `else` branch instead — which strips a
`"stale — last synced "` prefix (a no-op on the new text) and would have rendered the garbled
`"option mark from **no live price yet — sync quote, no real quote value has ever landed** — not
live-synced"`. Fixed in the same PR: the branch now matches on the one reason shape that actually
needs stamp-extraction (`reason.startsWith("stale — last synced ")`) and routes everything else
through the existing `pnlPct != null` ternary, which already independently derives the identical
real-vs-unknown distinction and needed no change.

### Finding 2 (RDW): `watchForSection`'s "Structural support/resistance node" line never discloses a fresh-compute-but-market-closed read

**Root cause:** `watchForSection()`'s "Structural support node"/"Structural resistance node" line
(`src/lib/swing/play-brief-intel.ts`) renders a GEX/dark-pool/king-strike level resolved from the
same Vector/GEX positioning snapshot every OTHER prose consumer of `closedMarketSessionNote`
already discloses when it fires: `chartLevelsSection`/`chartTechnicalsSection`'s closed-bucket
branches (this same file) and `dataHonestyCoaching`'s "Data caveat" bullet
(`play-brief-narrative-coaching.ts`), which applies it UNCONDITIONALLY across WATCH/OPEN/HOLD/
CLOSED, gated only on `!dead`. This line never carried the equivalent disclosure, for any bucket.
A post-close/weekend self-warm genuinely computes a fresh Vector/GEX read off the LAST session's
tape — ordinary staleness checks stay silent by design (the compute really is recent) — so a
member could read a confident structural level here with no hint that the market itself has been
shut for hours, directly alongside a brief that elsewhere discloses exactly that fact for the
identical snapshot.

**Fix:** computes `closedMarketSessionNote(vec, gexForLevels, readMs)` (both already in scope)
and appends it as an italicized parenthetical suffix to whichever of the LONG/SHORT lines
actually renders — scoped to this section's structural-node line specifically, for every bucket
(not closed-bucket-only), since a live WATCH/OPEN play reads the same snapshot a CLOSED one would.

### Tests

- `collectBriefUnavailableSources: a genuinely-unknown mark (no live tick ever landed) gets an
  honest reason, not the generic 'just untimestamped' wording` (`play-brief-absence.test.ts`) —
  RED pre-fix, GREEN post-fix.
- Two pre-existing `play-brief-absence.test.ts` fixtures (`{ markIsSync: true, status: "OPEN" }`
  with no `pnlPct`) were given `pnlPct: 5.2` so they continue to exercise the real-but-
  untimestamped case their own names/comments describe, rather than accidentally tripping the new
  genuinely-unknown branch.
- `watchForSection: Structural support node carries the market-closed session note when the
  Vector snapshot is fresh but the market is shut (Largo C2, 2026-10-25 fix)`
  (`play-brief-intel.test.ts`) — RED pre-fix, GREEN post-fix.
- Full `dataHonestyCoaching` suite (196 tests, `play-brief-narrative-coaching.test.ts`) and full
  `play-brief-absence.test.ts` (104 tests) and `play-brief-intel.test.ts` (326 tests) re-run clean
  after both fixes, confirming no regression in the consumer this finding's own fix touches.

### Blast radius

`collectOptionMarkStalenessAbsence` has exactly two real call sites
(`collectBriefUnavailableSources` in the same file, which pushes the reason verbatim with no
string-matching — unaffected; and `dataHonestyCoaching`, fixed above). `closedMarketSessionNote`
gains a 6th call site in `play-brief-intel.ts` (previously 5, all closed-bucket-only); no existing
call site's behavior changes.
