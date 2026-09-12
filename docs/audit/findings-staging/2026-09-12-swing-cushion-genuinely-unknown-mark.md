# Ask Largo swing play-brief's "Premium stop rail" cushion fabricated a percentage from the true entry-fallback mark

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty/trust — a specific, confident percentage rendered directly beside the same document's own honest "Mark: unknown... do not read as flat" line, for the exact same underlying value) |
| **Area** | Night Hawk Swings / Ask Largo — `src/lib/swing/play-brief-intel.ts` (`watchForSection`'s "Premium stop rail" cushion line); consumed by `GET /api/market/swing/play-brief`'s "What to watch" / "Watch levels" section for OPEN/HOLD/TRIM rows |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 5-engine live monitor + Ask Largo deep-dive cycle |

## Root cause

`play-brief.ts`'s `pnlSection` already knows that `play.markIsSync === true` does not by itself mean
"no real mark" — it is set as bluntly as `markAsOf == null` (adapters.ts), true for every
banger-lane row regardless of whether the underlying `last_mark` is real, because that lane's DB
row has no `mark_as_of` column at all. The TRUE entry-fallback signature (fixed there 2026-09-11,
live repro SWING:ALAB) is narrower: `markIsSync && pnlPct == null` — when `pnlPct` is a real
number, `livePnlPct(entry, mark)` could only have produced it from a real mark, so the mark behind
it is real too, just untimestamped; when `pnlPct` is null, there is no P&L basis, which is the
actual fallback case (`horizonPlayFromBangerPosition`'s `contract.mid = row.last_mark ?? entry_premium`
echoing entry back as `mark` verbatim).

`play-brief-intel.ts`'s `watchForSection` builds a separate "Premium stop rail" cushion percentage
— how far the mark can still fall before hitting the stop — computed straight off `play.mark` with
only `play.mark != null && play.mark > 0 && play.mark > stop` as a guard. The true entry-fallback
case always satisfies this: the fallback mark is exactly the entry premium, and the stop is set
below entry by construction (a option needs room to fall before it stops out), so
`mark > stop` is trivially true whenever `pnlPct` is null too. This is a second, previously
unguarded call site for the identical fallback value the Position section already knows not to
trust — computed independently, so the two disagreed without either being individually "wrong" in
isolation.

## Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:EBS&ticker=EBS&status=COMMIT&expandIntel=1`
(2026-09-12, authenticated via `scripts/audit/lib/prod-clerk-session.mjs`) — EBS is a real live
Banger-lane OPEN position, entry $0.10, stop $0.04, no live option-mark sync yet:

```
##### Position #####
Entry: **$0.10**
Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_
P&L: **—**
Peak: **—**

##### What to watch #####
...
Premium stop rail: **$0.04** — 60% cushion from current mark — thesis breaks if mark closes below
```

`(entry $0.10 − stop $0.04) / entry $0.10 × 100 = 60%` — the cushion line's own math against the
fallback mark, confirming it used the exact value the Position section, a few lines above in the
SAME envelope, says is not known. A member skimming only "What to watch" has no way to tell "60%
real cushion" from "60% computed off a placeholder that happens to equal entry".

## Blast radius

Only one call site: `watchForSection`'s cushion computation (`bucket === "open"` branch, the
"Premium stop rail" line). `pnlSection` (Position section, play-brief.ts) already had the correct
gate. No other section in `play-brief-intel.ts` or `play-brief-narrative.ts` independently derives
a percentage from `play.mark` without going through one of the two already-correct paths
(`dataFreshnessSection`'s "Mark age unknown" text, and `pnlSection`'s "Mark: unknown"). Grepped for
every other `play.mark` read in both files to confirm no third instance.

## Fix

Extracted the shared predicate as `optionMarkGenuinelyUnknown(play)` in `play-brief-absence.ts` —
the natural shared home for this kind of absence/staleness logic, already imported by both
`play-brief.ts` and `play-brief-intel.ts` — so the "true entry-fallback" test has exactly one
definition instead of being re-derived (and risking drift) a second time. `play-brief.ts`'s
`pnlSection` now delegates to it (behavior byte-identical, confirmed by its own passing test
suite); `play-brief-intel.ts`'s cushion computation now additionally requires
`!optionMarkGenuinelyUnknown(play)` before computing/showing the cushion percentage. The dollar
stop level (`Premium stop rail: **$0.04**...`) is untouched and still always shown — it is real
regardless of whether the mark is known; only the fabricated percentage is now omitted, exactly
the same "omit, never fabricate" discipline the existing null-mark test for this line already
established.

**Why centralize rather than just gate the one new call site inline**: the whole reason this bug
existed is that the "is this mark real" test was previously private to one file/function
(`pnlSection`'s local `const`), so a second, independent computation elsewhere in the same feature
had no way to reuse it and quietly recomputed something weaker. Inlining a second private copy in
`play-brief-intel.ts` would fix this one instance while leaving the same drift risk for the next
call site; exporting it once removes that risk going forward.

## Tests

Added to `src/lib/swing/play-brief-intel.test.ts`:
- `watchForSection: Premium stop rail omits the cushion note when the mark is the true entry-fallback echo (never fabricated)` — `entry: 0.1, mark: 0.1, markIsSync: true, pnlPct: null, stop_premium: 0.04`; asserts the dollar rail is still shown and no `cushion` text appears.

Verified RED before the fix (git-stashed `play-brief-absence.ts`/`play-brief-intel.ts`/`play-brief.ts`
only, kept the new test): new test fails, reproducing the exact live "60% cushion from current
mark" text. GREEN after: `play-brief-intel.test.ts` 99/99 pass, `play-brief.test.ts` 50/50 pass
(unchanged — `pnlSection`'s delegation to the extracted helper preserves its existing behavior).
Full `npm test` (Node 20): 13876 pass / 0 fail / 3 skipped. `npx tsc --noEmit` clean.

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` (#141) — during the next RTH session, pull the
play-brief for any live OPEN/HOLD/TRIM position whose option mark has not yet synced (Position
section reads "Mark: unknown") and confirm "Premium stop rail" shows only the dollar stop level
with no cushion percentage, while a position with a real synced mark still shows its cushion as
before.
