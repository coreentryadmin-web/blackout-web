> **kind:** FINDING

## Ask Largo Swing — top-level "Invalidation" line showed a moot gate reason for a dead WATCH play — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — member-facing narrative accuracy, not a live-trading-path change (read-only text) |
| **Component** | `src/lib/swing/play-brief.ts` — `composeSwingPlayBrief`'s `envelope.invalidation` fallback chain |
| **Found by** | NIGHT HAWK SWINGS standing audit lane, live MU WATCH brief repro, 2026-09-17/18 |

### Root cause

`composeSwingPlayBrief`'s `invalidation` computation (the string that feeds the play-brief's
top-level `**Invalidation:**` evidence-block line, distinct from any section body) is a fallback
chain: `thesisBreak.level === "break"` note, else `resolveBreakInvalidation(ctx)` (a real per-
ticker technical level), else `play.gateBlocks?.[0]?.reason` (a raw commit-gate string), else an
OPEN-only premium-stop line. None of those checked whether the play's entry is already **dead** —
`deadPlayReason(play)` (`entry-enterability.ts`): `setupState === "INVALIDATED"` or
`watchEntryExpired === true`.

This is the exact same root cause already fixed twice elsewhere in the same module for the same
class of bug:
- `watchEntrySection`'s "Gates blocking entry" header (this file, 2026-09-14 fix) — reframes the
  header to `**Also gate-blocked** (moot — ${dead})` once the entry window is dead, so the gate
  list doesn't read as an active/clearable blocker.
- `entryTriggerDeadReason` (`play-brief-intel.ts`, 2026-09-17 fix) — appends the same "moot"
  qualifier to the "Entry trigger" level line.

Both of those already import and call `deadPlayReason` for precisely this reason. The top-level
`invalidation` assignment never got the same treatment, so it kept falling straight through to
`play.gateBlocks?.[0]?.reason` — the raw, now-moot gate text, presented as if it were the live
condition standing between the member and entry.

### Evidence

Live MU WATCH brief, 2026-09-17/18 (`GET /api/market/swing/play-brief?playId=SWING:MU&ticker=MU`):
- Headline: `**EXPIRED — MU 970C 8DTE**`, correct.
- Entry section: `**Also gate-blocked** (moot — entry-validity window expired): g_s12_halt_feed_stale: ...`, correct — the "moot" fix already applied here.
- Watch levels section, entry trigger line: `... but entry-validity window expired — this level no longer fires the setup`, correct — the other existing "moot" fix.
- **Top-level `**Invalidation:**` line (pre-fix): `Trading-halt feed unavailable — desk will not open until halt/LULD data recovers.`** — the same moot G-S12 gate text, presented with no qualifier, directly contradicting the three correctly-worded call-outs elsewhere in the same brief. A member reading only the Invalidation callout (a summary block many members would scan first) would believe entry reopens once the halt feed recovers, when in fact the entry-validity window has already expired regardless of gate state — `evaluateSwingEntryEnterability`'s own if-chain checks the deadline/invalidation BEFORE gate-blocked, so clearing the gate was never going to reopen entry.

### Blast radius

Single call site — `composeSwingPlayBrief`'s `invalidation` assignment is the sole producer of
`envelope.invalidation` for the swing play-brief. No other consumer of this field exists outside
the envelope markdown renderer (`answer-envelope.ts:323`, `**Invalidation:** ${env.invalidation}`)
and the structured `envelope.invalidation` field itself (read by the UI/Largo tool-call surface
directly). Fix is scoped to `bucket === "watch"` only, matching the two existing sibling fixes
exactly — OPEN/CLOSED invalidation logic (premium-stop fallback, thesis-break note, CLOSED's
`null`) is untouched.

### Fix

Added a `dead = bucket === "watch" ? deadPlayReason(play) : null` check, inserted between the
existing `thesisBreak.level === "break"` branch and the `resolveBreakInvalidation(ctx)` fallback.
When `dead` is non-null, the invalidation line now reads `"${dead, capitalized} — this setup is no
longer live."` (e.g. `"Entry-validity window expired — this setup is no longer live."`) instead of
falling through to a real technical level or the moot gate reason — a dead play has no live
invalidation condition to speak of, whether technical or gate-based, so both later fallbacks are
correctly skipped once `dead` fires. Considered reusing `play.recNote` directly (already carries
the correctly-worded reason via `entry-verdict.ts`'s `enter.reason`) instead of `deadPlayReason`,
but rejected: `recNote` is populated for every WATCH verdict branch (BUY/WAIT/dont_buy alike, not
just the dead-play case), so using it unconditionally would have required re-deriving the same
dead/alive distinction `deadPlayReason` already encodes — reusing the purpose-built, already-
imported-in-this-file helper (used by its two sibling fixes) is the more precise, minimal choice.

### Test

`src/lib/swing/play-brief.test.ts`:
- `"top-level Invalidation line reflects a dead entry window, not a moot gate reason"` — RED
  pre-fix (`brief.envelope.invalidation === "Bucket not graduated"`, the fixture's moot gate
  reason), GREEN post-fix (`"Entry-validity window expired — this setup is no longer live."`).
- `"top-level Invalidation line still uses the real gate reason when entry is genuinely still
  open"` — companion negative case (no `watchEntryExpired`/`INVALIDATED` override), asserts the
  gate reason still surfaces unchanged when entry genuinely is still open — proves the fix is
  scoped to the dead-play case only, not a blanket behavior change.

Deliberate-break RED→GREEN proof done via `git stash`/`git stash pop` on `play-brief.ts` alone
(test file kept in place): pre-fix run showed the new test failing with `actual: 'Bucket not
graduated'` / `expected: 'Entry-validity window expired — this setup is no longer live.'`; post-fix
(`git stash pop`, diff-verified byte-identical to the intended fix) showed both new tests passing.
Full suite: `npx tsc --noEmit -p .` clean (Node 20); `npm test` 14600/14603 pass, 0 fail, 3
pre-existing skips (Node 20).
