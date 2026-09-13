> **kind:** FINDING

## Night Hawk Legacy — `isDegradedGapAway`'s reason-text match no longer matches the live "genuine contra-direction gap" case its own comment says it should catch — OPEN, holding

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"), no code changed |
| **Severity** | P2 (affects which DEGRADED plays engage the one-way, member-facing PULLED latch — a real, binding morning-confirm decision, not cosmetic) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate |

### What was found

`morning-verdict-persist.ts`'s `isDegradedGapAway` decides, for a `DEGRADED`-status play, whether
the gap-away is severe enough to engage the one-way pull latch on its own (single reason), via
three hardcoded substring checks against `status.reason`:

```ts
return (
  reason.includes("do not chase the published entry")
  || reason.includes("gapped above the entry range")
  || reason.includes("gapped below the entry range")
);
```

Its own header comment says: *"With entry re-anchoring (Phase 3.75), gap-through-entry in the
THESIS direction no longer degrades — the band is updated on the outcomes row. This now only
triggers on the legacy reason text (pre-reanchor) **or a genuine contra-direction gap**."*

Traced both halves of that sentence against the CURRENT `morning-confirm-verdict.ts` (the only
producer of these reason strings):

1. **"legacy reason text (pre-reanchor)"** — grepped the file for all three checked substrings:
   zero matches anywhere in current production code. The current thesis-direction gap-through-entry
   reason (line ~120) reads `"{ticker} pre-market {px} gapped {above/below} the entry range —
   entry re-anchored to pre-market"`, explicitly commented as *"Advisory only; no longer a pull
   trigger"* — correctly does NOT match `isDegradedGapAway`'s checks, which is right.
2. **"a genuine contra-direction gap"** — the only current DEGRADED-status reason that fits this
   description is line ~152-153: `"SPX gapped {±X.X} pts against {direction} direction —
   {ticker} pre-market still within plan, treat as caution"` (fired when SPX gaps against the
   play's thesis but the stock's own pre-market price still confirms within its band). This
   reason string does **not** match any of `isDegradedGapAway`'s three substrings either.

So today, a real "genuine contra-direction gap" DEGRADED play — the exact case the comment says
should still single-reason-engage the pull latch — does NOT trigger it: `isDegradedGapAway`
returns `false`, and `isDegradedSevere` falls through to requiring 2+ distinct reasons
(`DEGRADED_SEVERE_REASON_COUNT`), which this single-reason case never satisfies alone. The play
stays advisory-only (shown live, not PULLED) even though the code's own comment states the design
intent is otherwise.

### Why this is held, not fixed

This is a genuine product/calibration decision, not a mechanical string-matching bug fixable by
inspection alone:

- **Option A — the comment is current intent, the code is stale**: add a fourth substring check
  (or a `.includes("against") && .includes("direction")`-style match) for the contra-direction-gap
  reason text, making it single-reason-pullable as documented.
- **Option B — the comment is stale, the shipped 2-reason-or-legacy-string behavior is the actual
  current intent**: this contra-direction case is deliberately advisory-only today (the stock's
  own price still confirms the band, which is arguably a weaker signal than an outright band
  breach), and the header comment simply wasn't updated when this behavior was last touched.

Either is plausible from the code alone. Which one is right determines whether a real, live
DEGRADED play should or should not become non-tradeable-and-PULLED on the member board — exactly
the class of live-picks-logic decision this lane's standing policy says to report and hold rather
than pick a side on unilaterally.

### Secondary observation (not itself actioned)

`morning-verdict-persist.test.ts`'s existing test *"gap-away DEGRADED (single reason) engages the
pull latch"* exercises the pure function with the OLD, now-unproducible string ("...do not chase
the published entry"). The test still passes (it's a synthetic input to a pure function) but no
longer represents a reachable production case — worth revisiting once the question above is
resolved, so the test exercises whichever reason text the resolved policy actually produces live.

### What would resolve this

A product/ops call on which of Option A or B reflects the intended DEGRADED-pull policy for a
contra-direction gap where the stock's own price still nominally confirms — then update whichever
side (code or comment) is stale to match, and refresh the test to use a live-producible string.
