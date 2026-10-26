> **kind:** FINDING

## Swing play-brief "What changed" diff: HELIX call/put flow narration was mutually exclusive — a real move on one side could silently drop an equally real move on the other — FIXED

**Lane:** Night Hawk Swings (Ask Largo × Night Hawk Swings standing mandate)
**Date found/fixed:** 2026-10-26

### Root cause

`src/lib/swing/play-brief-diff.ts`'s `diffBriefSnapshots()` narrated HELIX call/put flow premium
shifts via an if/else-if/else-if chain:

```ts
if (callMoved && next.flowCallPremium! > prev.flowCallPremium! * 1.2) {
  lines.push("HELIX tape: call flow building");
} else if (putMoved && next.flowPutPremium! > (prev.flowPutPremium ?? 0) * 1.2) {
  lines.push("HELIX tape: put flow building");
} else if (callMoved || putMoved) {
  lines.push("HELIX tape: flow shifted");
}
```

Call and put flow premium are independent sentiment signals — a trader can see call flow collapse
while put flow builds in the same refresh window (a genuine reversal), and vice versa. But because
this was a single if/else-if chain, only the FIRST matching branch ever fired: whichever side the
chain reached first got narrated, and an equally material move on the other side was silently
dropped from the "What changed" pulse. This is the exact same "a real, material change goes
unnarrated" shape already fixed multiple times in this same file for other fields (missed section
removals, missed roll-watch clears, missed entry-gate-set shifts, missed diff overflow disclosure)
— every one of those every OTHER field (gamma flip, call wall, put wall, trims fired, roll watch,
gate blocks, section titles) is narrated via its own independent, unconditional `if` block; HELIX
call/put flow was the one field pair coupled into a single-slot chain.

### Blast radius

Single function, single call site inside `diffBriefSnapshots()`. No other consumer reads the
call/put-flow branch of this logic independently.

### Fix

Split the if/else-if/else-if chain into two independent `if` blocks — one for call flow, one for
put flow — each pushing its own "building" or "shifted" line exactly as before, but now able to
fire in the same pulse when both sides genuinely moved. Preserves byte-identical output for every
existing single-side-moved case (verified: both pre-existing tests for call-only and put-only
flow shifts still pass unchanged).

### Evidence

RED→GREEN: `src/lib/swing/play-brief-diff.test.ts` — new test constructs a refresh where call
premium collapses ($500k→$100k, -80%) while put premium builds ($400k→$900k, +125%) in the same
tick, and asserts BOTH a call-side and a put-side HELIX line appear. Failed pre-fix (only the
put-side line appeared, call collapse silently dropped — confirmed via the actual assertion
failure: `got: ["HELIX tape: put flow building"]`), passes post-fix (45/45 in the file). `tsc
--noEmit` clean; full suite running before PR.

| **Status** | FIXED |
