## 2026-09-12 — [FINDING, P3 product-quality] Ask Largo swing play-brief's "Entry trigger" line claimed a level "actually fires the setup" even after the setup was provably dead (INVALIDATED or past its entry-validity window)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product-quality/trust — a factual causal claim in Ask Largo's swing "Watch levels" section that is demonstrably false for two real, reproducible WATCH-bucket states, not a wrong number) |
| **Area** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`'s "Entry trigger" bullet) |
| **Found by** | Standing 5-engine live monitor + Ask Largo × Night Hawk Swings deep-dive — 2026-09-12 cycle |

### What was found

Live `GET /api/market/swing/play-brief` pulled for several real WATCH candidates, two of which
exposed the bug directly:

**SKHY** (`status=WATCH`, `setupState: "INVALIDATED"` — gate `thesis_invalidated`: "Structure
invalidated — price closed through the structural invalidation level"). "Watch levels" rendered:

```
Entry trigger: **177.00** — Break/reclaim above this is what actually fires the setup
```

Spot on the same read was **190.38** — already above the stated 177.00 trigger — yet the setup
had NOT fired (it is INVALIDATED, per the Verdict section's own "Desk is passing this setup — no
entry recommended"). The literal mechanic the sentence asserts ("break above this fires the
setup") had already been satisfied by price and demonstrably did not fire — the sentence directly
contradicts the rest of the same document.

**MRVL** (`status=WATCH`, past its entry-validity deadline — `watchEntryExpired: true`,
`entry-enterability.ts`'s `pastEntryDeadline`, first flagged 4 days ago against sub-lane's
2-5 day window). The Verdict headline correctly read `EXPIRED — MRVL 215C 7DTE` / "Entry-validity
window expired — wait for a fresh setup," but four sections later "Watch levels" still rendered
the identical unqualified "Entry trigger: 221.25 ... this is what actually fires the setup" line,
with no cross-reference to the EXPIRED framing three sections above.

### Root cause

`watchForSection`'s "Entry trigger" bullet rendered from `play.entryTriggerUnderlyingPx` alone,
unconditionally appending `"this is what actually fires the setup"` — it never checked the
setup's own already-computed dead state. Two fields already carry that state on `TerminalPlay`
for exactly this purpose, each wired in by an earlier, separate fix, but neither was consulted
here:
- `play.setupState === "INVALIDATED"` (thesis already broke — used elsewhere in this same file,
  e.g. `researchGateBlocks`/the Verdict "no entry recommended" copy).
- `play.watchEntryExpired === true` (entry-validity deadline passed — added by finding #144,
  2026-09-12, specifically so the headline could say EXPIRED instead of a generic WAIT; this
  bullet is four sections below that headline in the same document and never read the field
  #144 introduced for exactly this "is the setup actually still alive" question).

### Blast radius

Single call site — `entryTriggerUnderlyingPx`/`flagUnderlyingPx` are rendered nowhere else in the
brief (confirmed by grep); `play-brief-narrative-coaching.ts` deliberately does NOT re-render them
(its own comment: `watchForSection` already owns these two facts). No other consumer of
`TerminalPlay.entryTriggerUnderlyingPx` renders this causal sentence.

### Fix

Added `entryTriggerDeadReason(play)` in `play-brief-intel.ts`: returns a short, honest reason
string when `setupState === "INVALIDATED"` or `watchEntryExpired === true`, else `null`. The
"Entry trigger" bullet now appends that reason instead of the unqualified causal claim when one
applies — e.g. `"Entry trigger: **177.00** — Break/reclaim above, but thesis already invalidated
— this level no longer fires the setup"`. The numeric level itself is UNCHANGED and still shown
(still useful as "the level that would have mattered") — only the false causal claim is corrected,
never fabricated into something new. A live, still-enterable trigger (neither condition true)
keeps the original, unqualified sentence exactly as before — this fix narrows a false claim, it
does not soften a true one.

### Tests

`src/lib/swing/play-brief-intel.test.ts`:
- Added `"watchForSection: entry trigger claim is corrected, not fabricated, once the setup is
  INVALIDATED"` — asserts the level still renders, the old unqualified claim is gone, and the
  INVALIDATED reason is present.
- Added `"watchForSection: entry trigger claim is corrected, not fabricated, once the
  entry-validity window has expired"` — same shape for `watchEntryExpired: true`.
- Added `"watchForSection: a live, still-enterable trigger keeps the unqualified causal claim"` —
  guards against over-correcting: a play that is neither INVALIDATED nor expired must still get
  the original, correct sentence verbatim.

Verified RED before the fix (`git stash` on `play-brief-intel.ts` only, keeping the new tests):
2/110 failing (the two new INVALIDATED/expired tests; the third new test, unaffected by the bug,
passed both before and after) → 110/110 after restoring the fix. Full `npm test` (Node 20.20.2,
13949 tests, 13946 pass / 0 fail / 3 skipped) and `npx tsc --noEmit` both clean on the fix branch.
