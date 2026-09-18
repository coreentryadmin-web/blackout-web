# Ask Largo swing brief's stop rail is quantified with a live room%, but the symmetric target/upside rail is only ever a bare dollar figure

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `watchForSection` (`src/lib/swing/play-brief-intel.ts`), the "What to watch" section on OPEN positions |
| **Severity** | P3 — member-facing narrative enhancement (trade-manager-read quality), not a live-trading-path change |
| **Status** | FIXED — `fix/swing-target-rail-room-disclosure` |
| **Found by** | NIGHT HAWK SWINGS standing audit lane, live CRWD:39 OPEN brief, 2026-09-18, aggressive-mode improvement hunt |

### Root cause

`watchForSection`'s stop-cushion block (`bucket === "open" && play.exitPolicy?.stop_premium != null`)
quantifies "how far the current mark could still fall before hitting the stop" as a percentage —
mark/execMark-preferring, staleness-gated, never fabricated when the option mark is genuinely
unknown. Its own in-code history documents THREE separate live-repro fixes (2026-09-12 x2,
2026-09-14) making that computation increasingly correct: gating on the true entry-fallback echo,
preferring the real executable (bid) price over the more optimistic mid, and flagging "no real
cushion" outright once the bid has already reached the stop. The comment on the very first of
those fixes states the reason plainly: "the dollar level alone forces a member to do that
subtraction themselves."

`exitPolicy.target_premium` — the symmetric upside/target rail, equally real and already computed
— never received the equivalent treatment. Exhaustive grep across every narrative file in the
lane (`play-brief.ts`, `play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`,
`play-brief-intel.ts`) confirms it is rendered in exactly two places, both bare dollar figures with
zero distance/room context: `play-brief.ts`'s "Management" section ("Rails: stop X · target Y")
and `play-brief-narrative.ts`'s `tradeManagerNarrativeSection` ("Manage rails — stop X · target
Y"). A member reading the stop side is told "60% cushion from current mark"; reading the target
side, they are handed two raw numbers and asked to do the exact subtraction the stop-cushion fix's
own comment names as the reason it was added.

### Evidence

Live CRWD:39 OPEN brief, 2026-09-18 (`GET /api/market/swing/play-brief?playId=SWING:CRWD:39&ticker=CRWD`):

```
## Management
**Recommended:** TRIM
...
Rails: stop $5.08 · target $25.40
...
## What to watch
Thesis **intact**

Premium stop rail: **$5.08** — 64% cushion from current bid — thesis breaks if mark closes below
```

Mark was $14.65, target $25.40 — a real, informative "73% move still needed" fact that the brief
never states anywhere, despite quantifying the equivalent downside fact one line above it.

### Blast radius

Single new block inside `watchForSection`, additive only (a new line appended when the gate
conditions are met) — does not touch the existing stop-cushion block, the "Management" section's
bare `Rails: stop X · target Y` line (left as-is; still the correct place for the raw dollar
figures), or any exit-management/execution logic. `target_premium` is read-only here; no gate,
trim ladder, or manage-engine decision changes. Every OPEN swing brief with a known
`exitPolicy.target_premium` and a resolvable mark/execMark is affected (a strict superset of the
population that already sees the stop-cushion line, since both gate on the same `bucket === "open"`
branch).

### Fix rationale

Deliberately mirrors the stop-cushion block's exact basis/gating logic — execMark preferred over
mid when known and positive, gated on `!optionMarkGenuinelyUnknown(play)` — rather than reinventing
it, so the new line cannot independently drift into any of the three defect shapes the stop side
already had to be fixed for (true entry-fallback echo, mid-vs-exec divergence, stale/unknown mark).
Omitted (never a negative/zero fabrication) once the basis has already reached or passed the
target — a real, if less common, state for a position still open pending its own trim/exit
management, not specially messaged (unlike the stop side's "no real cushion" case, which was a
deliberate fix for a genuinely alarming state worth calling out explicitly; reaching a target early
is not similarly urgent).

### Test

`src/lib/swing/play-brief-intel.test.ts`, four new tests immediately following the existing
stop-cushion test block:
- `"Premium target rail shows the live room percentage to the target, not just the dollar level"`
- `"Premium target rail omits the room note when mark is unavailable (never fabricated)"`
- `"Premium target rail uses the executable (bid) basis, not the more optimistic mid, when they diverge"`
- `"Premium target rail omits the room note once the basis has already reached or passed the target (never a negative/zero fabrication)"`

Deliberate-break RED→GREEN proof via `git stash`/`git stash pop` on the source file only (test file
kept in place): reverting the source dropped exactly 2/151 tests (the two positive-assertion new
tests; the two "omit" tests trivially still pass against reverted source), diff-verified
byte-identical restore. `npx tsc --noEmit -p .` clean (Node 20). Full relevant scope
(`play-brief-intel.test.ts` + `play-brief.test.ts` + `play-brief-narrative.test.ts` +
`play-brief-narrative-coaching.test.ts`): 422/422 pass. Full `npm test` (Node 20): 14631/14634
pass, 0 fail, 3 pre-existing skips.
