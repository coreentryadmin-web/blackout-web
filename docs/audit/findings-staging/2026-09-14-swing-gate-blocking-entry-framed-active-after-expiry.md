> **kind:** FINDING

## Ask Largo swing WATCH briefs framed a moot gate as an active, clearable blocker after the play's entry window already expired — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `evaluateSwingEntryEnterability` (`entry-enterability.ts`) checks `pastEntryDeadline`
and `setupState === "INVALIDATED"` **before** it ever checks `gateBlocked.length > 0` (lines
155–194) — so once a play's entry window has expired or its structure has invalidated, entry is
already dead regardless of any gate state; clearing the gate would not make the play enterable.
`entry-verdict.ts` deliberately keeps `gateBlocks` attached to that same verdict anyway (per its
own comment, fixing a prior bug where real gate evidence was silently dropped whenever a play was
both expired AND gate-blocked). That data-retention choice is correct, but three of the four
renderers that consume `play.gateBlocks` phrased it unconditionally as **"Gates blocking
entry:"** / **"Gates blocking entry —"**, with no check against `play.watchEntryExpired` /
`play.setupState`. That header implies "clear this gate and you can enter" — false whenever the
play is already expired/invalidated, since the deadline/invalidation check fires first and
independently blocks entry either way.

**Evidence (live reproduction, 2026-09-14, ORCL):** live-pulled ORCL's play-brief
(`GET /api/market/swing/play-brief?playId=SWING:ORCL&ticker=ORCL`) — Verdict/Entry sections
correctly said `**Entry stance:** EXPIRED` / "Entry-validity window expired — wait for a fresh
setup," but the very same "Entry" section then printed `**Gates blocking entry:**\n• g_s4_regime:
...` with nothing marking the gate as moot; "Trade manager read" repeated the identical framing
(`**Gates blocking entry** — **g_s4_regime**: ...`). A member reading either bullet in isolation
sees a gate presented as the thing standing between them and entry, when in fact clearing
`g_s4_regime` would change nothing for this specific play. This is the same root cause
`entryTriggerDeadReason` (`play-brief-intel.ts`) already fixed once, 2026-09-12, for the sibling
"Entry trigger" line (live-repro'd on MRVL/SKHY) — that fix was never extended to the "Gates
blocking entry" render sites, which is why the identical bug class reappears in the very next
section of the same brief.

**Blast radius:** two real "full render" sites shared the same unconditional header —
`watchEntrySection` (`play-brief.ts`, the "Entry" section, the documented "one true home" for the
full gate list) and `watchGateCoaching` (`play-brief-narrative-coaching.ts`, the "Trade manager
read" section's own copy, per that section's own established two-homes-by-design convention). The
other two consumers of `play.gateBlocks` — `actionNarrative`'s "Entry stance" bullet
(`play-brief-narrative.ts`) and `watchForSection`'s "Before entry, clear: N gate(s)" pointer
(`play-brief-intel.ts`) — already only render a **count** with a pointer to one of the two homes
above (both were already fixed for a *duplication* bug on 2026-09-10/12), so fixing the two real
homes fixes what they point to as well.

**Fix:** extracted the shared expiry/invalidation check into `deadPlayReason()`
(`entry-enterability.ts` — a small, dependency-free leaf export, deliberately typed against a
narrow structural shape rather than importing `TerminalPlay`, so it can be imported by
`play-brief.ts`/`play-brief-narrative-coaching.ts`/`play-brief-intel.ts` without risking an import
cycle back through `play-brief-narrative.ts`, which already sits between `play-brief-intel.ts` and
`play-brief-narrative-coaching.ts` in the import graph). `entryTriggerDeadReason` now calls the
shared helper instead of duplicating the same two branches a third time. Both "Gates blocking
entry" render sites now check it: when the play is already dead, the header becomes `**Also
gate-blocked** (moot — thesis already invalidated):` / `(moot — entry-validity window expired):`
instead of asserting the gate as the operative, clearable blocker. The gate code/reason text
itself is unchanged — this only reframes what the gate *means* in context, exactly the same shape
as the already-shipped `entryTriggerDeadReason` fix.

**Fix rationale:** reusing `deadPlayReason` (rather than each site re-deriving the same two
branches independently, which is how this bug survived one fix cycle already) means any future
third dead-state reason added to this check fixes all three call sites at once. Kept the exact
original wording ("thesis already invalidated", "entry-validity window expired") rather than
introducing a cosmetic variant, so the existing `entryTriggerDeadReason` regression test
(`play-brief-intel.test.ts`) continues to pass unchanged.

**Test:** RED→GREEN proven (git-stashed the three source files, confirmed the 3 new tests fail
without the fix, restored and confirmed green). 4 new tests: 2 in
`play-brief-narrative-coaching.test.ts` (`watchGateCoaching` reframes for both expiry and
invalidation), 2 in `play-brief.test.ts` (`composeSwingPlayBrief`'s Entry section reframes when
expired, and — a regression guard — still frames the gate as the live blocker when the play is
genuinely still enterable). Full `src/lib/swing/*.test.ts` (1115 tests) green, `tsc --noEmit` and
`eslint` clean on all four touched source files.
