## 2026-10-31 — [FINDING, swing] `actionNarrative`'s "Entry stance" bullet implied clearing the gates reopens entry even when the very next bullet in the SAME section says it's moot

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (direct self-contradiction within one envelope's single section — a reader stopping at the first of two adjacent bullets reaches the opposite conclusion of the second) |
| **Surface** | `src/lib/swing/play-brief-narrative.ts` — `actionNarrative()` (watch branch) |

### Root cause

`actionNarrative`'s watch-bucket "Entry stance" bullet rendered `${gateCount} gate${...} blocking
entry — see below.` keyed purely on `play.gateBlocks.length`, with no check against
`gateFramingMootReason()` (`entry-enterability.ts`). That helper is already consulted by THREE
sibling renderers of the identical `play.gateBlocks` list — `watchEntrySection` (play-brief.ts),
`watchGateCoaching` (play-brief-narrative-coaching.ts), and `entryTriggerDeadReason`
(play-brief-intel.ts) — all of which correctly prefix the gate list with "(moot — ...)" whenever
clearing the named gates would NOT actually reopen entry (score below the lane floor, thesis still
FORMING, a legacy-exempt-only marker, or one of `deadPlayReason`'s four dead-entry cases).
`actionNarrative`'s bullet is a 4th renderer of the same data that never applied the same check —
and, worse, it is pushed into the brief FIRST, immediately before `watchGateCoaching`'s own
correctly-moot-framed bullet for the exact same gates (`tradeManagerNarrativeSection` calls
`actionNarrative` then `collectCoachingBullets`, which fires `watchGateCoaching` for
`bucket === "watch"`), so the two land back-to-back in the same "Trade manager read" section.

A 2026-10-21 FINDINGS.md fix (this file, same section heading pattern) already found and fixed the
identical gap at a different 4th call site — `watchForSection`'s "Before entry, clear: N gates"
bullet in `play-brief-intel.ts` — and that finding's own "Blast radius" section claimed the fix
was "confirmed by the same 3-sibling-renderer inventory ... all of which already handle it
correctly," implying no other unguarded renderer remained. `actionNarrative`'s bullet was a 5th
renderer that inventory missed: a repo-wide grep (`grep -rn gateFramingMootReason
src/lib/swing`) at the time of that fix would have shown `play-brief-narrative.ts` absent from the
list of files importing the helper, exactly as it still was going into this fix.

### Evidence

Live reproduction, `GET /api/market/swing/play-brief?playId=SWING:TSM&ticker=TSM&status=WATCH`
(2026-10-31 12:22 ET, TSM 415P 14DTE, SHORT, `setupState: "FORMING"`, `entryStatus:
"PRE_TRIGGER"`), inside the single "Trade manager read" section:
- Bullet 1 (`actionNarrative`): `**Entry stance** — WAIT. 3 gates blocking entry — see below.` —
  unqualified, implying clearing the 3 named gates would open entry.
- Bullet 2 (`watchGateCoaching`), immediately after, for the SAME `gateBlocks` array: `**Also
  gate-blocked** (moot — thesis still forming — not yet at trigger) — g_s4_regime: Broad-market
  regime degraded ... g_s6_confluence: Independent signal confluence below commit threshold ...
  g_s14_cortex: Cortex evidence nets negative against this setup ...`.
- The "Entry" section a few lines earlier already correctly reads `**Also gate-blocked** (moot —
  thesis still forming — not yet at trigger) — see Trade manager read below.` (the 2026-10-18
  `watchEntrySection` fix) — so 2 of 3 sections agreed the gates were moot and the 1 remaining
  (`actionNarrative`'s own bullet, which the brief places FIRST in "Trade manager read") still
  framed them as a real, clearable blocker.

Reproduced the exact shape in a unit test against the real, unmodified `tradeManagerNarrativeSection`
(not a hand-built string): a WATCH play with `setupState: "FORMING"`, `entryStatus:
"PRE_TRIGGER"`, and 3 gate blocks produced the self-contradictory pair verbatim pre-fix. RED→GREEN,
git-stash-verified on the source file alone (`play-brief-narrative.ts` stashed, test kept): 167/168
pass, 1 fail (the new test) before the fix; 168/168 after. Broader regression sweep: all
`src/lib/swing/*.test.ts` files — 2168/2168 pass. `tsc --noEmit` and `eslint` clean on both touched
files.

### Blast radius

Single bullet in a single function (`actionNarrative`, watch branch). No other call site renders
`play.gateBlocks.length` without the moot check: `watchEntrySection` (play-brief.ts),
`watchGateCoaching` (play-brief-narrative-coaching.ts), and `entryTriggerDeadReason` +
`watchForSection` (play-brief-intel.ts, the latter fixed 2026-10-21) all already call
`gateFramingMootReason`/`deadPlayReason` correctly — confirmed by re-running `grep -rn
gateFramingMootReason src/lib/swing` after this fix and verifying every renderer of
`play.gateBlocks` in the swing brief now appears in that list.

### Fix

`actionNarrative` now computes `gateFramingMootReason(play)` (only when `gateCount > 0`, same
guard pattern as the 2026-10-21 `watchForSection` fix) and branches: when moot, render `${gateCount}
gate${...} nominally blocking entry (moot — ${reason}) — see below.`; when genuinely live, keep the
existing `${gateCount} gate${...} blocking entry — see below.` text unchanged. Chose "nominally
blocking entry (moot — ...)" over `watchEntrySection`'s "Also gate-blocked (moot — ...)" phrasing
because this bullet, unlike that one, must still open with "Entry stance — WAIT." and state the
gate count (per its own in-code comment: "State the count here; the reason text has exactly one
home below" — `watchGateCoaching`) — the fix only qualifies the clause that was misleading, without
dropping the count or restructuring the bullet's established shape.

### Why not a bigger fix

Did not touch `gateFramingMootReason`/`deadPlayReason`/`entry-enterability.ts` — those are already
correct and already used by 4 other call sites; only this 5th renderer needed the same check
applied. Did not change the full-reason-text duplication discipline this bullet already observes
(stating only a count, pointing to `watchGateCoaching`'s bullet for the full per-gate text) — that
is a separate, already-fixed concern (2026-09-10) this finding doesn't touch.
