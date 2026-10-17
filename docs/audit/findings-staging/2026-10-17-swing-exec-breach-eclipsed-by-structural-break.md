> **kind:** FINDING

## Swing "Break watch" headline silently drops an already-breached executable stop when a structural GEX level is also broken — FIXED

**Lane:** Night Hawk Swings · Ask Largo play-brief · `src/lib/swing/play-brief-narrative.ts`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — correct data was present elsewhere in the brief, but the reserved risk headline a member actually reads under "HOLD" silently omitted the more urgent fact |

### Root cause

A 2026-09-15 fix (still in the file, unchanged) added logic so the "Break watch" headline bullet
says **"stop already breached on the executable side"** when the bid (`play.execMark`) is already
at or through the committed premium stop (`play.exitPolicy.stop_premium`) — rather than the
forward-looking "lose premium stop $X" framing, which that fix's own comment correctly notes is
misleading once the stop is already breached: *"A member trusting 'HOLD' at the top could easily
miss that their real exit is already past the intended risk line."*

That fix was gated behind `if (!breakLine && ...)` — it only fired when `breakTrigger()` (the
GEX-heuristic nearest put-wall/call-wall/dark-pool/GEX-king break level) had found **nothing** to
cite. Whenever `breakTrigger()` DID find a real structural level — which it very often will, since
most committed swing plays have an active put/call wall nearby — the executable-breach override
never ran, and the headline fell back to showing only the structural break line.

The executable-breach fact doesn't disappear entirely: it still renders as a footnote in
`play-brief-intel.ts`'s rails section (`cushionNote`, "no real cushion on the executable side").
But that is exactly the "footnote in a reference section, never in this reserved, always-surfaced
bullet" problem the 2026-09-15 fix's own comment describes — it just reappears whenever a
structural break line also happens to exist, which the original fix never tested for.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:GTLB&ticker=GTLB&expandIntel=1` (2026-10-17,
Night Hawk Swings standing mandate, weekend audit cycle):

- Position: GTLB 59C 6DTE, LONG, status HOLD, entry $0.65, mid mark $0.30 (-53.8% P&L), **bid
  $0.10 (-84.6% exec P&L)**, premium stop rail **$0.26**.
- `$0.10 <= $0.26` → the executable side has unambiguously breached the stop.
- The brief's rails footnote correctly said *"no real cushion on the executable side (bid already
  at/through this level)"*.
- But the reserved "Break watch" headline bullet — the one line every Ask Largo brief surfaces
  up front as the risk callout — read: **"Break watch — lose 27.50 on a closing basis →
  structural support failed; exit or cut size."** (the put-wall structural level), with no
  mention anywhere in the headline that the executable side was *already* through its own stop.

Confirmed via code read (`play-brief-narrative.ts` lines ~1506-1529 before this fix) that this is
structural, not a one-off: `breakLine` is computed first from `breakTrigger()`, and the
executable-breach override at the old `if (!breakLine && ...)` only ever ran when that call
returned `null`. No existing test exercised the combined case — every prior test for the
"already breached" bullet (`tradeManagerNarrativeSection: Break watch says the stop is ALREADY
breached...`, `SHORT Break watch also flags an already-breached executable stop`) used a bare
`ctx()` fixture with no `vector`/`ecosystem` data, so `spot` was `null`, `breakTrigger()` short-
circuited to `null`, and the `!breakLine` guard was trivially satisfied every time — masking this
exact gap.

### Fix

`src/lib/swing/play-brief-narrative.ts`: compute `execBreached` unconditionally and, when true,
add it as its **own** reserved bullet (via `add(..., { reserved: true })`) regardless of whether
`breakLine` is also non-null — additive, per the Largo product contract's additive principle
(never replacing the structural break line, never replacing the fallback forward-looking framing
when the stop is *not* yet breached). The non-breached fallback path (`!breakLine && execStop !=
null`) is unchanged.

### Blast radius

Single call site — `tradeManagerNarrativeSection` in `play-brief-narrative.ts` is the only place
this logic lives; `committedStructuralStopLine` (the separate 2026-10-16 fix for the real
*underlying-price* committed stop) is an independent code path and unaffected. No other consumer
imports this exec-breach branch.

### Regression test

`src/lib/swing/play-brief-narrative.test.ts`:
*"tradeManagerNarrativeSection: executable-side stop breach still surfaces when a structural GEX
break ALSO exists (live GTLB shape)"* — supplies both a structural put wall (via `vector.gexWalls`)
AND an executable-side breach (`execMark <= stop_premium`), and asserts both bullets render
independently. RED pre-fix (`git stash` on the source file alone reproduced the failure, 1/136
failing), GREEN post-fix (136/136). Full suite: 16223 pass / 0 fail / 3 skipped. `tsc --noEmit`
clean.
