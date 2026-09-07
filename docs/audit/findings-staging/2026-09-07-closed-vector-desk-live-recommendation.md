# Ask Largo swing brief: "Vector desk" section renders a live, actionable trade call on CLOSED plays

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Ask Largo / Night Hawk Swings play-brief |
| **PR** | (this branch) |

## Symptom

Live production repro (2026-09-07, all four CLOSED swing chains — CCI positionId 31, AMZN
positionId 27, GLW positionId 22, NOW positionId 21): `GET /api/market/swing/play-brief` for a
CLOSED position still rendered a full "Vector desk" section with the CURRENT, live Vector play
read for that ticker — entry zone, price targets, an invalidation level, and a starred "Watch
now:" directive — badged bullish/bearish, immediately below a "Trade manager read" narrative that
had already reported the position as STOPPED/TARGET days earlier. Example (AMZN, closed
2026-08-28, read 2026-09-07):

```
Vector desk
POSITION · momentum long on continuation → target 1σ 264.84 · grade B · conviction 68
Entry zone: long on strength / pullback hold
Targets: 1σ 264.84 · call wall 270 · 2σ 271.17
Invalidation: 5m close < 266.06
Watch now:
• POSITION · momentum long on continuation → target 1σ 264.84
```

This reads as a live, actionable recommendation to re-enter a trade that already exited nine
days earlier — the exact opposite of what a post-mortem brief should show, and the same defect
class already fixed for the "Watch levels" section in the immediately-preceding fix
(`fix/closed-watch-levels-thesis-framing`, "closed swing plays no longer read as a live thesis in
Ask Largo brief"): a section computed fresh from LIVE, present-tense data leaking unmodified into
a CLOSED play's retrospective brief, violating the Largo product contract's identity/direction
point (whose call is this, and is it live?).

## Root cause

`vectorDeskSection()` in `src/lib/swing/play-brief-intel.ts` took no `bucket` parameter at all —
unlike its sibling `watchForSection()`, which already branches on `"watch" | "open" | "closed"`.
`buildIntelSections()` called it unconditionally (`vectorDeskSection(vec, ctx.sessionDate)`) for
every bucket, and `collapseRedundantIntelSections()` deliberately returns every section unfiltered
for the closed bucket (by design — GEX/wall/macro/flow context should stay visible as
frozen-at-close information, per the comment at `play-brief-intel-collapse.ts:43-46`). That design
is correct for genuinely informational sections, but `vectorDeskSection`'s body is not
informational — it is Vector's live directive block (entry zone / targets / invalidation / starred
"Watch now" calls), so nothing in the pipeline ever downgraded it for a closed play.

## Blast radius

Only `vectorDeskSection` renders this directive shape — `chartTechnicalsSection` and
`wallDynamicsSection` also read from the same `VectorFullState.play`/`.technicals`/`.regime` but
only ever surface the grade or dealer-gamma-regime fact (already reviewed and left unchanged; no
entry/target/invalidation phrasing there). No other call site of `vectorDeskSection` exists outside
`buildIntelSections`.

## Fix

- `vectorDeskSection(vec, sessionDate, bucket)` gains a `bucket` parameter (default `"open"` to
  match every existing caller/test outside this brief). For `bucket === "closed"`, it renders only
  an informational one-liner — current grade/conviction "since this play closed" — with a forced
  `bias: "neutral"`, and drops thesis/entryZone/targets/invalidation/starred entirely. Same
  contract-driven approach `watchForSection` already established for the closed bucket: informative
  and honestly time-stamped, never a live directive.
- `buildIntelSections` passes `bucket` through to `vectorDeskSection`.
- Watch/open buckets are byte-identical to before (regression test below asserts both shapes).

## Fix rationale

Deliberately did NOT touch `collapseRedundantIntelSections`'s closed-bucket "return sections
unfiltered" behavior — that guard exists to PRESERVE frozen GEX/wall/macro/flow context for closed
plays (2026-09-06 finding, referenced in that file's own comment) and is still correct for every
other section. The bug was narrower: one specific section (`vectorDeskSection`) was never bucket-
aware in the first place, so it never had a chance to render the closed-appropriate framing that
the collapse step assumes already exists upstream.

## Evidence

- Live repro above (CCI/AMZN/GLW/NOW, 2026-09-07, `GET /api/market/swing/play-brief`).
- Regression test `vectorDeskSection: CLOSED bucket suppresses the live entry/targets/
  invalidation/watch-now directive block` in `src/lib/swing/play-brief-intel.test.ts` — RED before
  this fix (`bias` came back `"bullish"` instead of `"neutral"` for a closed play with a live long
  bias), GREEN after; asserts watch/open buckets are unchanged.

## Verify

```
export PATH=/opt/node20/bin:$PATH
npx tsx --test src/lib/swing/play-brief-intel.test.ts
```
