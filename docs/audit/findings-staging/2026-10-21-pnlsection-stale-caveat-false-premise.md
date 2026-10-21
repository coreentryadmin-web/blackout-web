## Position section's "stale" caveat on Greeks/Spread/premium rails falsely claims the Mark line already flagged it — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive, round 2 (live-
fetched real swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified
before acting), focused on sections not yet audited that day.

**Root cause:** `pnlSection` (`src/lib/swing/play-brief.ts`) renders the `Mark:` line via three
branches: `markGenuinelyUnknown` → `"Mark: unknown (...)"`, `markUnsynced` → `"Mark: $X (live
quote, no freshness timestamp)"`, and a fallback (neither flag set) → `"Mark: $X (ET timestamp)"`
with **no confidence wording at all**. Separately, `staleCaveat` is computed and appended to the
Greeks line and the Spread/Quote line whenever `optionMarkIsStale(play, readMs)` is true (which can
only be true in exactly the fallback-Mark case — the other two branches gate it out), using the
literal text `" _(stale — same quote Mark flagged above)_"`. That text asserts the Mark line
directly above already disclosed the staleness — but the fallback branch that renders in exactly
this case carries zero staleness wording, so the premise was false every time the caveat fired.

**Blast radius:** this file's own 2026-10-21 fix for `watchForSection` (play-brief-intel.ts,
`railStaleCaveat`, folded into FINDINGS the same day) copied the identical `" _(stale — same quote
Mark flagged above)_"` wording for the Premium stop/target rail lines, reasoning the two call
sites should "read as one consistent disclosure." Traced `composeSwingPlayBrief`'s own section
order: for the `bucket === "open"` branch (the only bucket either premium rail line can render,
confirmed by their own `if (bucket === "open" && ...)` gates), `pnlSection` ("Position") is always
pushed before `buildIntelSections` (which includes `watchForSection`/"Watch for") — so the "above"
claim was spatially correct in every case, and the single shared defect was simply that the Mark
line itself never said "stale." Fixing the Mark line alone makes all four render sites (Greeks,
Spread, Premium stop rail, Premium target rail) truthful without touching `watchForSection` at all.

**Evidence:** CRWV (COMMIT/OPEN, positionId 63) Position section: `Mark: **$4.40** (2026-10-20
16:00 ET)` — no staleness wording — followed by `Greeks: ... _(stale — same quote Mark flagged
above)_` and `Spread: ... _(stale — same quote Mark flagged above)_`. The existing regression test
for this exact caveat (`play-brief.test.ts`, "Greeks and Spread both carry a 'stale' caveat...",
live repro TSLA/CRWV, markAsOf 4.5h stale) only ever asserted the Greeks/Spread lines' text and
never asserted anything about the Mark line, confirming the gap was never checked.

**Fix:** `src/lib/swing/play-brief.ts` — the Mark line's fallback branch now appends `" _(stale)_"`
when `optionMarkIsStale(play, readMs)` is true, consistent with the other two branches' own
in-line confidence caveats (`markGenuinelyUnknown`/`markUnsynced` already carry one each).

**Tests:** `src/lib/swing/play-brief.test.ts` — extended the existing stale-caveat test with a new
assertion that the Mark line itself now carries `(stale)`. RED→GREEN proven via `git stash` on the
source file alone (1 fail / 158 pass without the fix, 159/159 with it). `tsc --noEmit` clean. Full
`play-brief-intel.test.ts` (305/305) re-run unaffected, confirming `watchForSection` needed no
direct change.

**Why not a bigger fix:** considered rewording the caveat itself (e.g. referencing "Data freshness"
instead of "above") but rejected it — that section renders much later in the document and isn't
adjacent to Position, so it would trade one spatial claim for a worse one. Making the Mark line
itself honest is the minimal fix that makes every existing downstream reference true, including the
one this same mandate shipped earlier the same day.
