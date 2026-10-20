## SPX Slayer's gate-block humanizer never recognized the mixed-tape gate, producing an incoherent raw-plus-humanized duplicate in `gates.blocks` — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, 5-engine live monitor cycle, SPX Slayer live correctness check
(production, read-only) — independently re-verified against the current source before fixing.

**Root cause:** `humanizeGateBlock` (`src/features/spx/lib/spx-play-intel.ts:155`) checked for
the mixed-tape gate via:

```ts
if (block.includes("headwinds") || block.includes("too many conflicts")) {
  return buildPlayIdeaIntel(desk, confluence) ?? block;
}
```

but the only real mixed-tape gate message, built once in `spx-play-gates.ts:314`:

```ts
const mixedTapeMsg = `${GATE_BLOCK.MIXED_TAPE} — too many conflicting signals for clean entry`;
// = "Tape's mixed — too many conflicting signals for clean entry"
```

does **not** contain the substring `"too many conflicts"` — the real text says "conflicting
signals", not "conflicts". So this branch never fires for the one real gate it was written for.
`"headwinds"` is also dead code — grepped the whole `src/` tree; that word never appears in any
gate message anywhere.

**Live impact confirmed before fixing:** current production payload (`GET /api/market/spx/play`,
grade `C`, `desk_context.mixed_tape_blocked: true`) carried, back to back in `gates.blocks`:
```
"Tape's mixed — too many conflicting signals for clean entry"
"Tape's mixed, but Calls lean — 7710 Call on watch · At 0DTE support node 7710 (+1 pts) · waiting for grade confirmation"
```
Both describe the identical mixed-tape condition, but a member/Largo reader sees them as two
unrelated reasons — one raw technical string, one an actionable idea with a `"waiting for grade
confirmation"` suffix that actually belongs to a *different* gate (grade-below-minimum), not the
mixed-tape gate. This silently defeats `humanizeGateBlocks`' own dedup logic (added 2026-09-28 for
exactly this incoherent-duplicate failure mode), since dedup only tracks strings it actually
transformed — an untouched raw string never enters the dedup pool.

**Fix:** Corrected the keyword match to `"too many conflicting signals"` (the real substring) and
dropped the dead `"headwinds"` alternative.

**Fix rationale:** Minimal, targeted correction of the match string — no new mechanism, just
making the existing (already-correct) humanize-and-dedup pipeline actually reach the one real gate
message it was supposed to cover from the start.

**Blast radius / test update required:** fixing this means the mixed-tape block now correctly
enters the SAME dedup pool as every other gate, and under the existing (unchanged) "first
occurrence wins" tie-break (`humanizeGateBlocks`' own documented design — "whichever gate rule ran
first, not an arbitrary pick"), mixed-tape — now evaluated first in realistic gate order — wins
over a later, more-suffixed duplicate for the same condition. The existing regression test
(`spx-play-intel.test.ts`, 2026-09-28 live-repro test) had unknowingly encoded the OLD buggy
behavior as its expectation (asserting the suffixed variant "wins" and that the raw mixed-tape
string "survives untouched") only because mixed-tape was accidentally excluded from the dedup pool
by this exact bug. Updated that test's assertions to the now-correct outcome, with an inline note
explaining why, and added a dedicated new test that proves the original live-reported defect
(raw-plus-humanized incoherent duplicate) is gone.

**Tests:** 2 new/updated tests in `spx-play-intel.test.ts` — the mixed-tape block is now itself
humanized and collapses to one idea line with `grade-below-minimum`'s duplicate (not left as an
incoherent raw+humanized pair); a dead-keyword regression test confirms a message merely
containing the word "headwinds" is no longer rewritten. RED→GREEN proven via `git stash` (2/2 fail
against the pre-fix source — the dead-keyword test gets the wrong (humanized) output instead of
the expected untouched one). `tsc --noEmit` clean. Full `spx-play-intel.test.ts` (7 tests) and
`spx-play-payload.test.ts` (7 tests) green, no other regressions.
