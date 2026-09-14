> **kind:** FINDING

## Ask Largo's degraded-spot "Live read" bullet rendered the entry-premium fallback as a confident live mark — 3rd instance of an already-fixed root cause — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `degradedReadLine` (`src/lib/swing/play-brief-narrative.ts`, the "Live read" bullet
inside "Trade manager read" that fires whenever Vector spot isn't wired on a given tick) built its
`markBit` clause as `play.mark != null ? ... : ""` — rendering ANY non-null `play.mark` as a
confident dollar figure. But for a fresh banger-lane row with no synced quote yet,
`horizonPlayFromBangerPosition` sets `play.mark === play.entry` (the entry-premium echo, not a real
live price) — the exact "true entry-fallback" case `optionMarkGenuinelyUnknown`
(`play-brief-absence.ts`) exists specifically to detect (`markIsSync === true && pnlPct == null`).
Two sibling call sites in this same lane already gate on that shared helper — `pnlSection`'s own
"Mark: unknown" line (`play-brief.ts`, fixed 2026-09-11/12) and the "Premium stop rail" cushion
(`play-brief-intel.ts`, fixed 2026-09-12) — but `degradedReadLine` was never patched for the
identical root cause, making this the 3rd instance of the same defect class in the swing play-brief
lane.

**Evidence (live reproduction, 2026-09-14, RKLX and PGY):** both real, fresh banger-lane HOLD
positions showed the self-contradiction in the same document. RKLX's brief read, a few lines apart:

> Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_
> ...
> **Data caveat** — mark not synced to live tape.
> ...
> **Live read** — Vector spot not wired on this tick; desk still says **HOLD** · mark **$0.51**. Levels refresh on next poll.

`$0.51` is RKLX's entry premium, presented as a current live mark directly beside two honest
disclosures — from the Position section and the Data caveat bullet — that the mark is not actually
known. PGY showed the identical pattern (`mark **$0.17**` = its entry premium). Found via forensic
batch 8 of the standing Night Hawk Swings audit mandate (CLAUDE.md).

**Blast radius:** `degradedReadLine` is the sole source of the "Live read" bullet — every OPEN/HOLD/
TRIM play whose Vector spot isn't wired on a given request AND whose mark is still the true
entry-fallback echo (fresh banger-lane rows with no synced quote) is affected. No other call site
independently renders this bullet.

**Fix:** `markBit` now also requires `!optionMarkGenuinelyUnknown(play)` before rendering — the same
shared guard the two sibling call sites already use, imported into this file for the first time.
When the mark is genuinely unknown, the clause is omitted entirely (never replaced with a "not
shown" placeholder) — the bullet already degrades gracefully when other optional clauses
(`healthBit`, `givebackBit`) are absent, so a missing `markBit` reads naturally, not as a gap.

**Fix rationale:** matched the established fix pattern exactly (omit-on-unknown, imported shared
helper) rather than inventing a different resolution for this 3rd instance, so the three call sites
can't drift apart a second time — the same discipline `optionMarkGenuinelyUnknown`'s own doc comment
states as the reason it was extracted to a shared module in the first place.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed a new live-shaped RKLX/PGY
regression test fails against pre-fix code with the exact wrong output — "mark **$0.51**" rendered —
restored and confirmed green). Added a second regression test proving the fix narrows correctly:
a markIsSync row with a REAL `pnlPct` (a genuine, if untimestamped, quote) still renders its mark —
the fix suppresses only the true entry-fallback case, not every synced-without-timestamp mark. Full
`src/lib/swing/*.test.ts` (1127 tests) green, `tsc --noEmit` and `eslint` clean on both changed files.
