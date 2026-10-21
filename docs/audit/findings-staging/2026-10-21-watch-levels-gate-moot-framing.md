## 2026-10-21 — [FINDING, swing] `watchForSection`'s "Before entry, clear: N gates" bullet implied clearing the gates reopens entry even when the same envelope's own narrative says it's moot

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (direct self-contradiction within one envelope — a section-local read leads to the opposite conclusion of the brief's own narrative) |
| **Surface** | `src/lib/swing/play-brief-intel.ts` — `watchForSection()` |

### Root cause

`watchForSection`'s "Watch levels" section renders `**Before entry, clear:** ${n} gate${...} — see
Trade manager read above.` keyed purely on `play.gateBlocks.length`, with no check against
`gateFramingMootReason()` (`entry-enterability.ts`). That helper is already consulted by THREE
sibling renderers of the identical `play.gateBlocks` list — `watchEntrySection` (play-brief.ts),
`watchGateCoaching` (play-brief-narrative-coaching.ts), and `entryTriggerDeadReason` (a few lines
above in this same file) — all of which correctly prefix the gate list with "(moot — ...)" whenever
clearing the named gates would NOT actually reopen entry (score below the lane floor, thesis still
FORMING, or a legacy-exempt-only marker). The "Before entry, clear: N gates" line is a 4th renderer
of the same data, phrased as an imperative instruction, that never applied the same check.

A 2026-09-14 FINDINGS.md fix reasoned this 4th site was safe because it "already only renders a
count with a pointer to one of the two homes" that got fixed — but `watchEntrySection`'s own
non-moot branch (`**Gates blocking entry:** ${gateCount} gate${...} — see Trade manager read
below.`) is the IDENTICAL "count + pointer" shape and still applies the moot check, disproving
that rationale.

### Evidence

Live reproduction, both real WATCH candidates in the same fetch:
- **TSLA**: "Watch levels" → `**Before entry, clear:** 4 gates — see Trade manager read above.`
  while "Trade manager read" (same envelope) → `**Also gate-blocked** (moot — below the lane score
  floor) — g_s3_earnings: ... · g_s12_halt_feed_stale: ... · g_s4_regime: ... · g_s14_cortex: ...`
  and "Lane rank" → `#5 of 7 on WATCH lane · score **31.1** (-20 vs median)`.
- **SHOP**: identical pattern — `**Before entry, clear:** 1 gate ...` vs `**Also gate-blocked**
  (moot — thesis still forming — not yet at trigger) — legacy_exempt: ...`.

A reader relying on just the "Watch levels" section (a plausible read path, since sections are
titled and often consumed individually) would conclude clearing the named gate(s) is sufficient to
enter — the opposite of what the same envelope's own "Trade manager read" section says two
sections earlier.

Added two tests to `play-brief-intel.test.ts` (one for the moot case, matching the live TSLA
repro's `aboveFloor: false`; one control confirming a genuinely live gate list still renders the
imperative count + pointer, unchanged). RED→GREEN, git-stash-verified on the source file alone:
309/310 (1 fail) before the fix, 310/310 after. Broader regression sweep: `play-brief.test.ts` +
`play-brief-narrative-coaching.test.ts` + `entry-enterability.test.ts` — 690/690 total.
`tsc --noEmit` clean.

### Blast radius

Single bullet in a single function. No other call site renders `play.gateBlocks.length` without
the moot check — confirmed by the same 3-sibling-renderer inventory this finding's own root-cause
section names, all of which already handle it correctly.

### Fix

`watchForSection` now computes `gateFramingMootReason(play)` the same way its siblings do and
branches: when moot, render `**Also gate-blocked** (moot — ${reason}) — see Trade manager read
above.` (mirroring `watchEntrySection`'s own moot-branch wording); when genuinely live, keep the
existing imperative "Before entry, clear: N gates" text unchanged.

### Why not a bigger fix

Did not touch `gateFramingMootReason`/`deadPlayReason`/`entry-enterability.ts` — those are already
correct and already used by 3 other call sites; only this 4th renderer needed the same check
applied. Did not change the full-reason-text duplication discipline this bullet already observes
(pointing to "Trade manager read" rather than re-rendering each gate's reason) — that's a separate,
already-fixed concern (2026-09-12/2026-10-08) this finding doesn't touch.
