# Ask Largo CLOSED-play "Trade manager read" collapses 2-3 separate post-mortem points into one illegible run-on bullet

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (member-visible narrative-quality defect, no data loss) |
| **Area** | Swing / Ask Largo CLOSED-play "Trade manager read" section, `closedCoaching()` |
| **Files** | `src/lib/swing/play-brief-narrative-coaching.ts` (`closedCoaching`), `src/lib/swing/play-brief-narrative-coaching.test.ts` (1 new test) |

## Context

Live capture from `GET /api/market/swing/play-brief?playId=SWING:AAPL&ticker=AAPL&positionId=36`
(a real closed swing position) during the standing Ask Largo deep-dive mandate, 2026-09-10:

```
## Trade manager read
• Exited **-56.2%** vs peak **+1.3%** **Round-tripped past breakeven** — was up **+1.3%** at
peak, closed at **-56.2%**; tighten at first trim rail next time. **Stop fired** (stopped) —
check if entry was extended past invalidation.
```

Three semantically distinct post-mortem facts — the raw outcome, the round-trip/MFE-capture
verdict, and the exit-reason lesson — are jammed into a single `•` bullet with no separator
between them, reading as one confusing run-on sentence. Every OTHER coaching point in this same
narrative system (OPEN/WATCH buckets, and every other closed-play section like "Lessons") renders
each distinct point as its own bullet.

## Root cause

`closedCoaching()` (`play-brief-narrative-coaching.ts`) accumulates up to three lines — the raw
outcome, an MFE-capture/round-trip verdict, and a `closedReason` lesson — into a local `lines:
string[]`, then returned `lines.join(" ")`: a bare-space join collapsing all of them into one
string. `collectCoachingBullets()`'s closed-bucket branch (`push(closedCoaching(play))`) treats
whatever `closedCoaching` returns as exactly ONE bullet (`push` only prefixes `• ` once, on the
whole string) — so every other coaching function in this file gets one `push()` call per point
(one bullet each), but `closedCoaching` pre-joins its own multiple points before ever reaching
`push()`, defeating the one-bullet-per-point convention the rest of the system follows.

## Evidence

New test in `play-brief-narrative-coaching.test.ts`, RED→GREEN verified via `git stash` on
`play-brief-narrative-coaching.ts` only:
- **RED** (pre-fix): `closedCoaching()` with both an outcome+round-trip note and a
  `closedReason` returns a single space-joined string — `line!.split("\n• ")` yields 1 element,
  not 3.
- **GREEN** (post-fix): the same call returns a string with `\n• ` separators between each
  point — `split("\n• ")` yields exactly 3 elements, each matching its expected content.

The existing two `closedCoaching` tests (MFE-capture lesson, round-trip-capture-sign fix) still
pass unchanged — they regex-match substrings of the returned string, which the internal
separator change doesn't affect.

Full swing test suite (`play-brief-narrative-coaching.test.ts` + 3 related files, 224 tests):
clean. `npx tsc --noEmit`: clean.

## Blast radius

`grep -rn "closedCoaching"` confirms exactly one real call site
(`collectCoachingBullets`'s closed-bucket branch); a second reference
(`play-brief-intel.ts`'s `lessonsSection` doc comment) is prose only, not a call. No other
function consumes `closedCoaching`'s return value, and its signature (`string | null`) is
unchanged — only the internal join separator changed, so `collectCoachingBullets`'s `push()`
call needed no edit: it already treats the returned string as opaque, and the embedded `\n• `
separators are exactly what `tradeManagerNarrativeSection`'s final `bullets.join("\n")` expects
to render as separate lines.

## Fix rationale — what was deliberately left unchanged

Considered changing `closedCoaching`'s return type to `string[]` and updating
`collectCoachingBullets` to push each line individually (the "textbook" fix, matching how every
other coaching function is called) — rejected as unnecessarily invasive for what the actual defect
is: this is the ONLY caller and the ONLY place `closedCoaching`'s return value is consumed, so a
type-level restructuring changes more surface (both this file's export, its two other tests, and
the caller) than a one-line separator fix that produces byte-identical rendered output. Chose
`\n• ` (rather than plain `\n`) specifically because `collectCoachingBullets`'s `push()` only
prefixes the FIRST line of whatever it's given with `• ` — embedding the bullet marker in the
join is what makes the second/third points render as proper bullets rather than un-marked
continuation lines.
