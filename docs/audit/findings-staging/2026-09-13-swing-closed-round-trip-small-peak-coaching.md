> **kind:** FINDING

## Ask Largo's CLOSED-play "round-tripped past breakeven" lesson gave trim-discipline advice even when the peak never got near a trim rail — ENHANCEMENT (shipped)

| **Status** | FIXED |
|---|---|

### Root cause / gap

Not a correctness bug — every number in the closed-play Lessons section is accurate. But
`closedCoaching()`'s (`play-brief-narrative-coaching.ts`) round-trip lesson always closed with the
same generic advice regardless of how large the peak actually was:

```
**Round-tripped past breakeven** — was up **+1.3%** at peak, closed at **-56.2%**; tighten at
first trim rail next time.
```

This is the live AAPL#36 repro (deep-audited this session, Night Hawk Swings standing mandate):
the swing-scale-out ladder's first real trim rail fires at +100% (`SWING_SCALE_OUT_POLICY`), and
this position's peak was +1.3% — nowhere near it. "Tighten at first trim rail next time" implies a
trim decision was missed, but there was never enough room to make one; the position round-tripped
almost immediately after entry. Contrast with a real trim-discipline miss like CRWD (peak
+129.7%, well past the rail) or NN (peak +24.4%), where the same advice is exactly right.

Worth noting the sibling branch two lines below (the MFE-capture case, not round-trip) already
encodes this exact judgment — `else if (capture < 35 && play.peak > 20)` — so the code already
distinguished "was there a real move to protect" for one branch but not the other.

### Fix

`closedCoaching()`'s round-trip branch now reuses that same `> 20` threshold (not a new one) to
pick between two trailing clauses:

- peak > 20%: unchanged — `"tighten at first trim rail next time."`
- peak <= 20%: `"barely cleared breakeven before reversing — a trim rail wouldn't have helped
  here; review entry timing or thesis strength instead."`

The leading `**Round-tripped past breakeven**` phrase and the peak/exit figures are untouched, so
every existing test asserting only that prefix (or a loose substring match) stays compatible
unmodified.

### Blast radius

Single branch, single function (`closedCoaching`, `play-brief-narrative-coaching.ts`). Only the
trailing advice clause on the round-trip case changes; the capture branch, exit-reason line, and
every other coaching path are untouched.

### Fix rationale

Reused the existing `20` threshold from the adjacent capture branch rather than picking a new
number — removes the "what threshold" judgment call entirely, since the codebase had already made
this exact call once. Kept the leading phrase/figures identical so the change is additive to the
sentence, not a rewrite, minimizing risk to every other consumer of this line's shape.

### Evidence of testing

- New tests in `play-brief-narrative-coaching.test.ts`: a real-peak (129.7%) round-trip still gets
  the unchanged trim-rail advice; a near-zero-peak (1.3%, the live AAPL#36 repro) round-trip gets
  the new entry/thesis advice and explicitly asserts the old trim-rail phrase is ABSENT.
- RED confirmed: only the new near-zero-peak test failed before the fix (1/77); the real-peak test
  already passed (proves the >20 path is genuinely unchanged, not coincidentally rewritten).
- GREEN: 77/77 `play-brief-narrative-coaching.test.ts` pass.
- Full `src/lib/swing/*.test.ts`: 1086/1086 pass.
- Full `npm test` (Node 20): 14101/14101 pass, 0 fail, 3 pre-existing unrelated skips.
- `npx tsc --noEmit`: clean.

Found and shipped during the Night Hawk Swings standing aggressive-mode mandate (hunt for genuine
enhancements every cycle) — logged as an ambiguous product-copy observation three cycles ago while
auditing AAPL#36's live CLOSED brief, revisited and judged small/unambiguous enough to ship once a
threshold-reuse approach removed the open judgment call.
