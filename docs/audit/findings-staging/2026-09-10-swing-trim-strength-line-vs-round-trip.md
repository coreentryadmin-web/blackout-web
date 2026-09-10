> **kind:** FINDING

## Ask Largo swing brief — TRIM coaching claimed "into strength" the same sentence it said the peak was already gone — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo play-brief, "Trade manager read" narrative |
| **Severity** | P2 — member-visible contradictory guidance on a real open production position, no incorrect data |
| **Found by** | Live OPEN-position forensic pass, `GET /api/market/swing/play-brief?playId=SWING:NN&ticker=NN&positionId=32`, 2026-09-10 12:00 ET |

### What was broken

`actionNarrative()`'s TRIM branch (`src/lib/swing/play-brief-narrative.ts`) always rendered the
same hardcoded coaching sentence regardless of the play's current state relative to its peak:

```ts
if (rec === "TRIM") {
  const next = play.exitPolicy?.trim_levels?.find((t) => !t.fired);
  lines.push(
    `**Desk says TRIM**${next ? ` — next rail at **+${next.trigger_pct}%**` : ""}. ` +
      `Bank partial into strength; don't give back peak.`,
  );
}
```

Immediately after, the same section independently appends a `mfeCaptureOutcome`-driven
round-trip bullet whenever the current pnl has gone negative after a positive peak. Both can fire
together, and when they do the result is self-contradicting. Live capture, NN (`SWING:NN:32`,
2026-09-10 12:00 ET, a real committed position):

```
• Desk says TRIM — next rail at +100%. Bank partial into strength; don't give back peak.
  Round-tripped past breakeven — was up 24% at peak, now -35% — consider protecting what's left.
```

"Bank partial into strength; don't give back peak" tells the member to protect a peak that the
very next clause says is already gone — past breakeven, into a loss. The advice is stale by the
time it's read: there is no peak left to protect, and the position isn't "in strength." A member
skimming only the first sentence would form the wrong picture of where the trade actually stands.

### Root cause

The TRIM branch's coaching text was written assuming the play is still at or near its peak (the
normal, common case for a TRIM recommendation), with no check against the same round-trip
condition the very next bullet already computes. The two bullets are logically related (both
describe "where is this play relative to its peak") but were written independently, so nothing
kept them consistent once a real position round-tripped past breakeven while still carrying a
TRIM recommendation (the trim ladder's un-fired +100% rail persists structurally even after price
has fallen well below it).

### Fix

Moved the existing `mfeCaptureOutcome` computation earlier in the function (previously computed
after the recommendation branch, now before it) so the TRIM branch can check the same round-trip
condition. The "Bank partial into strength; don't give back peak" clause is now omitted when
`giveback?.kind === "round_trip"` — the round-trip bullet immediately after already carries the
real, current, correct guidance ("consider protecting what's left"), so nothing is lost; the
stale claim is just no longer stated first.

### Evidence

Two new tests in `src/lib/swing/play-brief-narrative.test.ts`:
- "TRIM recommendation does not claim 'into strength' once the play has already round-tripped
  past breakeven" — real numbers from the live NN capture (peak +24.4%, pnl -34.6%). RED before
  the fix (asserted the "into strength" phrase was absent, got it present), GREEN after.
- "TRIM recommendation keeps the 'into strength' line when the play has NOT round-tripped (still
  a live gain)" — confirms the common case (CRWD-shaped: peak +129.7%, pnl +8.6%, still a genuine
  gain) is unaffected — the fix is conditional, not a removal.

Full swing test suite (`play-brief-narrative.test.ts` + `play-brief.test.ts` +
`play-brief-intel.test.ts` + `play-brief-narrative-coaching.test.ts`, 226 tests) + full `npm test`
+ `npx tsc --noEmit`: clean.

### Blast radius

Single call site (`actionNarrative`'s TRIM branch). The `giveback` computation itself, the
round-trip bullet, and the capture/giveback bullet below it are all unchanged in behavior — only
moved earlier in the function body so the TRIM branch can read the same result rather than
recomputing it. `SELL` and the default `HOLD` branches were not touched; they don't carry an
analogous "still near peak" claim to contradict.

### Why this and not something bigger

Considered also softening the wording when `giveback?.kind === "capture"` with a large giveback
(e.g. gave back 70%+ of peak but hasn't gone negative) — deferred: that case already gets its own
separate "Gave back X% of peak — consider protecting runner" bullet right after, which is a softer
warning appropriate to a play still in profit; "into strength" isn't factually wrong there the way
it is once the play has actually round-tripped into a loss, so narrowing the fix to the round_trip
case specifically (not touched: 74%-retained gains, which still read as "in strength" honestly) is
the smaller, correct slice.
