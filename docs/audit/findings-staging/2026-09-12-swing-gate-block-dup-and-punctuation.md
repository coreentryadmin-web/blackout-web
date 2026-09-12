## 2026-09-12 — [FINDING, P3 product-quality] Swing play-brief narrative restates the same fact twice at three independent call-site pairs — gate-block reasons across two sections, a doubled trailing period, and a round-trip fact across two "Trade manager read" bullets

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product-quality/trust — no wrong number, but a member reads the same fact stated twice verbatim in three different spots across two live briefs, plus a sentence that visibly ends in "..") |
| **Area** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`'s "Watch levels"/"Before entry, clear:" bullet), `src/lib/swing/play-brief-narrative-coaching.ts` (`watchGateCoaching`'s "Trade manager read" gate bullet), and `src/lib/swing/play-brief-narrative.ts` (`degradedReadLine`'s "Live read" fallback bullet) |
| **Found by** | Standing 5-engine live monitor + Ask Largo × Night Hawk Swings deep-dive — 2026-09-12 cycle (covering the 09:10/09:20 UTC firings) |

### What was found

Live `GET /api/market/swing/play-brief?playId=SWING:ORCL&ticker=ORCL&status=WATCH` (2026-09-12,
real WATCH candidate, gated on `g_s4_regime`/`g_s14_cortex`):

**Bug 1 — cross-section duplication.** The "Entry" section rendered:
```
**Gates blocking entry:**
• g_s4_regime: Broad-market regime degraded — desk will not open new swings (WATCH only).
• g_s14_cortex: Cortex preflight vetoed this setup — desk will not open.
```
...and the LATER "Watch levels" section rendered the identical two lines again, verbatim, under
a different header:
```
**Before entry, clear:**
• g_s4_regime: Broad-market regime degraded — desk will not open new swings (WATCH only).
• g_s14_cortex: Cortex preflight vetoed this setup — desk will not open.
```

**Bug 2 — doubled trailing period.** The same brief's "Trade manager read" section rendered:
```
**Gates blocking entry** — **g_s4_regime**: Broad-market regime degraded — desk will not open new
swings (WATCH only). · **g_s14_cortex**: Cortex preflight vetoed this setup — desk will not open..
```
— note the trailing `"..".`

**Bug 3 — round-trip fact duplicated within "Trade manager read" itself.** Live
`GET /api/market/swing/play-brief?playId=SWING:CRWD&...&status=OPEN` (2026-09-12, real committed
CRWD TRIM position, Vector spot not wired this tick), "Trade manager read" section:
```
• **Desk says TRIM**. **Round-tripped past breakeven** — was up **130%** at peak, now **-10%** —
  consider protecting what's left.
• ...
• **Live read** — Vector spot not wired on this tick; desk still says **TRIM** · mark **$15.07** ·
  round-tripped past breakeven — was up **130%** at peak, now **-10%**. Levels refresh on next poll.
```
The identical "round-tripped past breakeven ... 130% ... -10%" fact appears in two different
bullets of the same section.

### Root cause

**Bug 1:** `watchForSection` (`play-brief-intel.ts`, "Watch levels" section) and `watchEntrySection`
(`play-brief.ts`, "Entry" section) both independently read `play.gateBlocks` and render it in full
as `` `${code}: ${reason}` `` bullets. `composeSwingPlayBrief` always places the "Entry" section
BEFORE the intel sections (which end with "Watch levels") for a WATCH play, so every gated WATCH
brief carries the same gate codes+reasons twice. This is the exact duplication shape the codebase
had already found and fixed ONCE before, in a different pair of call sites: `play-brief-narrative.ts`'s
"Entry stance" bullet (in "Trade manager read") used to re-render the same gate reasons
`watchGateCoaching`'s own bullet already carries in full, fixed by stating only a count there with
a comment — "the reason text has exactly one home below." That fix narrowed the duplication to
ONE place within "Trade manager read"; it never touched the separate "Entry" vs "Watch levels"
pair, which carried the identical anti-pattern unfixed.

**Bug 2:** `watchGateCoaching` joins each gate's `` `${code}: ${reason}` `` (plus an optional
`unlock_et` suffix) with `" · "`, then appends a literal `"."`. Every real gate `reason` string in
`entry-verdict.ts`'s gate-block map already ends with its own period (e.g. `"...desk will not
open."`), so the unconditional append doubles it whenever the LAST rendered gate has no
`unlock_et` (the common case — no unlock time is known for most gates).

**Bug 3:** `tradeManagerNarrativeSection` (`play-brief-narrative.ts`) always calls `actionNarrative`
first, which unconditionally renders "Round-tripped past breakeven — was up X% at peak, now Y%"
whenever `mfeCaptureOutcome(play.pnlPct, play.peak, null).kind === "round_trip"` (regardless of
`rec`). Separately, whenever Vector `spot` is null on that read, the SAME function ALSO calls
`degradedReadLine` — a supplementary "Live read" fallback bullet that independently recomputes the
exact same `mfeCaptureOutcome` on the exact same inputs (so it always agrees with `actionNarrative`
on `giveback.kind`) and, for the `round_trip` case, restated the identical fact a second time. The
two functions are not mutually exclusive — `degradedReadLine` runs IN ADDITION TO `actionNarrative`
whenever `spot == null`, never instead of it.

### Why the existing tests never caught any of these

Neither `play-brief-intel.test.ts` nor `play-brief-narrative-coaching.test.ts` had ANY test
exercising `watchForSection`'s or `watchGateCoaching`'s gate-block bullet against realistic
`reason` strings — the one existing `watchGateCoaching` test used a fixture reason with no
trailing punctuation (`"wait for trigger"`), which cannot exhibit either bug: it's a single string
(no cross-section comparison possible from one test) and it doesn't end in a period (can't double
what isn't there). For Bug 3, `play-brief-narrative.test.ts` has separate tests for
`actionNarrative`'s round-trip bullet and for `degradedReadLine`'s giveback clause (a `capture`-kind
case, not `round_trip`) — both existing tests use `assert.match` (substring presence), which passes
whether the fact appears once or twice, so neither noticed the two functions firing together on the
exact same round_trip input in the exact same brief.

### Blast radius

All three fixes are scoped to the swing play-brief narrative surface only — no other consumer of
`play.gateBlocks`, `watchGateCoaching`, or `degradedReadLine` exists outside these four files
(`play-brief.ts`, `play-brief-intel.ts`, `play-brief-narrative-coaching.ts`, `play-brief-narrative.ts`);
confirmed by grep.

### Fix

**Bug 1:** `watchForSection`'s "Watch levels" bullet no longer repeats the full reason text —
it states a count with a pointer to the Entry section above (`` `**Before entry, clear:** ${n}
gate${n===1?"":"s"} — see Entry section above.` ``), mirroring the same "count here, full text has
one home elsewhere" pattern already used inside "Trade manager read."

**Bug 2:** `watchGateCoaching` now checks whether the joined `gates` string already ends in
terminal punctuation (`/[.!?]$/`) before appending a closing period, so it adds one only when
actually needed — future reason strings without their own punctuation still get sentence-closed.

**Bug 3:** `degradedReadLine` no longer restates the `round_trip` giveback fact — since
`actionNarrative` ALWAYS renders it unconditionally whenever `giveback.kind === "round_trip"`, by
the time `degradedReadLine` runs (only when `spot == null`) the fact is already stated. The
`capture`-kind branch is untouched: `actionNarrative` only renders that one below its OWN 75%
floor, while `degradedReadLine`'s floor is 80% — a `capturePct` in [75,80) is genuinely new
information there, not a proven duplicate, so it was left alone absent live evidence of it also
double-firing.

### Tests

- `src/lib/swing/play-brief-intel.test.ts`: added `"watchForSection: gate-block bullet is a count
  + pointer, not a second full copy of Entry's reason text"` — asserts the new count+pointer
  wording and that neither gate's full reason text appears in this section's body.
- `src/lib/swing/play-brief-narrative-coaching.test.ts`: added `"watchGateCoaching: does not
  double the period when the reason already ends in one (live ORCL repro)"` — uses realistic
  period-terminated reason strings and asserts no `".."` appears and the line ends in exactly one
  period.
- `src/lib/swing/play-brief-narrative.test.ts`: added `"tradeManagerNarrativeSection: round-trip
  fact appears exactly once even when the degraded 'Live read' fallback also fires (live CRWD
  repro)"` — a TRIM position with `spot` null (so both `actionNarrative` and `degradedReadLine`
  fire) and a `round_trip` giveback, asserting the fact's substring count is exactly 1.

Verified RED before each fix (`git stash` on the respective source file only, keeping the new/
updated tests): `play-brief-intel.test.ts` 1/97 failing → 97/97 after; `play-brief-narrative-
coaching.test.ts` 1/72 failing → 72/72 after; `play-brief-narrative.test.ts` 1/62 failing → 62/62
after (294/294 when all four test files are run together). Also ran `play-brief.test.ts` and
`entry-verdict.test.ts` (the other call sites/consumers of `gateBlocks`) — all green, including the
pre-existing de-dup test for the OTHER (already-fixed) duplication pair, confirming these fixes
don't regress it. Full `npm test` (Node 20, 13850+ tests) and `npx tsc --noEmit` both clean on the
fix branch.
