# Ask Largo swing WATCH brief — gate-block text duplicated back-to-back in "Trade manager read" — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-swing-watch-gate-bullet-dedup |
| **Priority** | P3 |
| **Area** | Ask Largo / Night Hawk Swings — `GET /api/market/swing/play-brief` |
| **Status** | FIXED |

## Symptom

Found during the standing Ask Largo deep-dive mandate (5-engine live monitor cycle, 2026-09-10),
by pulling a live WATCH-lane swing brief (`EWY`, `SWING:EWY`, COMMIT_NOW/AT_TRIGGER, two blocking
gates) through prod. The composed "Trade manager read" section carried the SAME two gate
code+reason strings TWICE, back-to-back, as two separately-worded bullets:

```
• Entry stance — WAIT. Clear gates: g_s12_halt_feed_stale: Trading-halt feed unavailable — desk
  will not open until halt/LULD data recovers. · g_s6_confluence: Independent signal confluence
  below commit threshold — desk will not open..
• Gates blocking entry — g_s12_halt_feed_stale: Trading-halt feed unavailable — desk will not
  open until halt/LULD data recovers. · g_s6_confluence: Independent signal confluence below
  commit threshold — desk will not open..
```

This is exactly the "narrative section reading like a bullet dump instead of connected
trade-manager voice" defect class the standing Ask Largo mandate calls out — a member reading the
brief sees the identical fact stated twice in a row with no new information in the second bullet.

## Root cause

`tradeManagerNarrativeSection` (`src/lib/swing/play-brief-narrative.ts`) composes the section by
calling `actionNarrative(play, bucket)` first, then folding in every bullet from
`collectCoachingBullets(ctx, bucket, spot)` (`src/lib/swing/play-brief-narrative-coaching.ts`).
For the WATCH bucket, BOTH functions independently render the play's `gateBlocks`:

- `actionNarrative`'s watch branch built `Clear gates: ${gateBlocks.slice(0,2).map(g => `${g.code}:
  ${g.reason}`).join(" · ")}.` inline into the "Entry stance" bullet.
- `collectCoachingBullets` unconditionally calls `watchGateCoaching(play)`
  (`play-brief-narrative-coaching.ts:134`) right after for the same bucket, which builds
  `**Gates blocking entry** — ${gateBlocks.slice(0,3).map(...).join(" · ")}.` — the same codes and
  reason text, just capped at 3 instead of 2 and with an `unlock_et` hint when present.

The section's own de-duplication guard (`tradeManagerNarrativeSection`'s `add()`, keyed via
`seen.add(line.slice(0, 48))`) exists precisely to catch this class of repeat, but it keys on each
line's FIRST 48 CHARACTERS — and these two bullets open with different wording ("Entry stance —
WAIT. Clear gates: g_s12_halt_fee…" vs "Gates blocking entry — g_s12_halt_feed_stale: Tra…"), so
the guard never recognizes them as the same fact. It only catches duplicates that are
character-identical at the front, not ones that restate the same content with a different lead-in.

## Evidence

Live capture, `GET /api/market/swing/play-brief?playId=SWING:EWY&ticker=EWY&status=WATCH&...` (one
temp Clerk premium session, `scripts/audit/lib/prod-clerk-session.mjs`, deleted after): the
"Trade manager read" section body contained both bullets above verbatim, each carrying the
identical `g_s12_halt_feed_stale`/`g_s6_confluence` code+reason text.

RED→GREEN, `src/lib/swing/play-brief-narrative.test.ts` (`tradeManagerNarrativeSection: watch
bucket gate reasons appear once, not duplicated across Entry stance + Gates blocking entry`):
asserts each gate's reason string appears **exactly once** in the composed body, and that both the
terse "Entry stance" count and the detailed "Gates blocking entry" bullet are still present (this
is de-duplication, not deletion of information). `git stash` on `play-brief-narrative.ts` alone
(test file kept) reproduced the failure pre-fix (`expected 1, found 2` on both gate-reason
strings) — 39/40 pass, 1 fail; restoring the fix brought it to 40/40.

Full suite: `node --import tsx --test src/lib/swing/play-brief-narrative.test.ts
src/lib/swing/play-brief-narrative-coaching.test.ts src/lib/swing/play-brief.test.ts
src/lib/swing/play-brief-intel.test.ts` — 192/192 pass. Full `npm test` (Node 20) — 13432 pass, 0
fail, 3 skipped (pre-existing, unrelated). `npx tsc --noEmit` — clean.

## Blast radius

Single call site: `actionNarrative`'s WATCH branch in `play-brief-narrative.ts`, which is only
reached from `tradeManagerNarrativeSection` for `bucket === "watch"` — i.e. every swing WATCH-lane
brief with `gateBlocks` set (any pre-entry candidate blocked by a commit gate: halt-feed-stale,
confluence-floor, cortex-thin-evidence, etc.). `watchGateCoaching` itself, its test, and every
other bucket (`open`/`closed`) are untouched — this only removes the redundant restatement, it
does not change what `watchGateCoaching` renders.

## Fix rationale

Kept `watchGateCoaching`'s bullet as the single source of truth for gate reasons (it is strictly
more complete: 3 gates vs. 2, plus the `unlock_et` clearing-time hint `actionNarrative` never had).
Changed `actionNarrative`'s "Entry stance" bullet to state only the blocking-gate COUNT
(`"N gate(s) blocking entry — see below."`) instead of re-rendering the first two gates' reason
text — "see below" is safe because `collectCoachingBullets` (and therefore `watchGateCoaching`,
gated on the exact same `play.gateBlocks?.length` condition) is always invoked immediately after
`actionNarrative`'s bullet is added, within the same `tradeManagerNarrativeSection` call, for every
watch-bucket play. Considered instead removing `watchGateCoaching`'s call from
`collectCoachingBullets` and keeping the inline version in `actionNarrative`, but that would have
dropped the third gate and the `unlock_et` hint for every gated WATCH brief — a net loss of
information for a de-dup fix. Did not touch the front-side `seen`/48-char de-dup guard itself: it
correctly catches the (more common) case of two bullets that are actually near-identical from the
start, and broadening it into fuzzy/substring matching risks false-positive suppression of bullets
that legitimately share a few words; the surgical fix is not building two bullets with the same
payload in the first place.

## Existing structural note (not this bug)

This same live read also confirmed several ALREADY-FIXED/already-scoped gaps behave correctly and
were NOT re-flagged: `unavailableSources` correctly disclosed `GEX positioning`/`Vector desk state`
as unavailable when the corresponding `Chart technicals`/GEX-derived `levels` were honestly omitted
for `CRWD`; the `gex_walls_veto_relieved` grace-period flag (#4656) postdates an `ASTS` record row
observed with the pre-fix narrative/decision mismatch it was built to prevent (row committed
2026-09-09 15:34 UTC, fix landed 2026-09-09 16:43 UTC — historical data, not a live gap); and
Thesis health's "Inputs not wired for committed positions" scaffold on `NRG`/`CRWD` is the known,
already-documented partial gap from #4679 (regime pillar fixed, setupState/entryStatus/signalKinds
still deferred) — none of these needed a new fix this cycle.
