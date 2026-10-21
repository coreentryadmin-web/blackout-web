## 2026-10-21 — [FINDING, P2 Ask Largo x Night Hawk Swings / Largo product contract] RESEARCH/SKIP swing candidates render "HOLD" in the "Trade manager read" narrative's "Entry stance" and "Live read" bullets — deferred follow-up to #6532 — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### Symptom

#6532 (merged, 2026-10-21) fixed `src/lib/swing/play-brief.ts`'s headline/`thesis`/Verdict-section
copy, which all rendered the literal word **"HOLD"** for a RESEARCH/SKIP swing candidate (the desk
declining a setup — nothing was ever entered), one sentence away from text saying the setup was
being passed on. That PR's own body and staged finding
(`docs/audit/findings-staging/2026-10-21-swing-skip-hold-headline-leak.md`) explicitly named the
IDENTICAL fallback-chain shape in `src/lib/swing/play-brief-narrative.ts` as unfixed blast radius —
not reproduced in that PR's live evidence, deliberately deferred rather than widening that PR's scope.

Confirmed real by reading the current (post-#6532) source directly, both call sites:

1. **`actionNarrative`'s "Entry stance" bullet** (feeds `tradeManagerNarrativeSection`'s "Trade
   manager read" section, the SAME section as #6532's Verdict-line fix, just a different file) —
   for `bucket === "watch"`:
   ```ts
   const actionLabel =
     swingActionDisplay(play)?.label ?? play.swingEntryAction?.toUpperCase() ?? rec;
   ```
   where `rec = play.recommendation ?? "HOLD"`. For a SKIP play: `swingActionDisplay` deliberately
   returns `null` (`play-card-lifecycle.ts`'s own "SKIP deliberately returns null so the honest
   PASSED lifecycle pill shows" comment), `swingEntryAction` is always `null` for SKIP
   (`adapters.ts` line 908's `"buy" | "still_buy"` narrowing — never set for a declined candidate),
   so the chain falls straight through to `rec` — the literal `"HOLD"` string
   `SwingEntryVerdict.recommendation` (`entry-verdict.ts`'s RESEARCH branch) always stamps.
   Rendered: `"**Entry stance** — HOLD. Wait for setup maturity before sizing."`
2. **`degradedReadLine`'s "Live read" bullet** (fires whenever Vector/GEX spot isn't wired this
   tick — the common case for a RESEARCH candidate with no live position tracking it):
   ```ts
   const rec =
     swingActionDisplay(play)?.label ??
     play.recommendation ??
     play.swingEntryAction?.toUpperCase() ??
     "HOLD";
   ```
   Same root cause, same literal result: `"**Live read** — Vector spot not wired on this tick;
   desk still says **HOLD**. Levels refresh on next poll."`

Both bullets sit in the exact same "Trade manager read" section #6532's Verdict-line fix already
corrects in the same brief — so, pre-fix, a RESEARCH/SKIP candidate's brief could read "PASSED"
in the Verdict line and headline (post-#6532) while still reading "HOLD" twice more, a few lines
down, in the narrative coaching bullets — a self-contradicting brief, not a resolved one.

Live production reproduction was not practical this cycle (no RESEARCH-bucket candidate happened
to sit on the current board that would exercise BOTH code paths without additional unrelated
contextual data) — the evidence below is a precise unit-level reproduction against the real,
unmodified functions with a constructed SKIP-status fixture, per this finding's own disclosure
requirement.

### Root cause

Same as #6532: `SwingEntryVerdict.recommendation` (`entry-verdict.ts`) is typed `"BUY" | "HOLD"` —
a two-value field with no distinct "pass"/"skip" value — so the RESEARCH branch reuses the literal
`"HOLD"` to mean "no BUY signal," not "hold an existing position." `swingActionDisplay` and
`swingEntryAction` both null out for SKIP by design (nothing to label — see their own doc
comments), so any `action?.label ?? ... ?? play.recommendation` fallback chain silently bottoms
out on that overloaded `"HOLD"` string for a SKIP row. #6532 fixed the three call sites it had live
evidence for (`play-brief.ts`'s headline/`thesis`/Verdict line) via a new, exported
`swingVerdictVerb(play, action)` helper that checks `play.status === "SKIP"` FIRST (an early
return, not one more `??` fallback step — necessary because `play.recommendation` is always
non-null `"HOLD"` for SKIP, so an appended fallback would never be reached). This finding is the
two call sites that PR explicitly named as unfixed blast radius.

### Fix

Exported `swingVerdictVerb` from `play-brief.ts` (it was a private function) and imported it into
`play-brief-narrative.ts`, reusing it at both call sites rather than re-deriving the SKIP special
case a second and third time:

```ts
// actionNarrative, bucket === "watch":
const action = swingActionDisplay(play);
const actionLabel =
  play.status === "SKIP"
    ? swingVerdictVerb(play, action)
    : action?.label ?? play.swingEntryAction?.toUpperCase() ?? rec;

// degradedReadLine:
const degradedAction = swingActionDisplay(play);
const rec =
  play.status === "SKIP"
    ? swingVerdictVerb(play, degradedAction)
    : degradedAction?.label ?? play.recommendation ?? play.swingEntryAction?.toUpperCase() ?? "HOLD";
```

Both sites guard with an explicit `play.status === "SKIP"` ternary rather than unconditionally
replacing the whole chain with `swingVerdictVerb(play, action)`, because neither chain is
byte-identical to `swingVerdictVerb`'s own non-SKIP fallback (`action?.label ?? play.recommendation
?? play.status`) — both have an extra `swingEntryAction` fallback step `swingVerdictVerb` doesn't,
and a different final default (`rec`/`"HOLD"` vs. `play.status`). The ternary changes behavior
ONLY for `play.status === "SKIP"`; every other `deckStatus` falls through the exact prior chain,
unchanged — proven by a dedicated regression test rather than asserted.

**A note on the import direction:** `play-brief-narrative.ts` now imports from `play-brief.ts`,
while `play-brief.ts` already imports `resolveBreakInvalidation` FROM `play-brief-narrative.ts` —
a genuine circular import between the two files (an existing code comment in
`play-brief-narrative.ts`, next to its own independently-duplicated `anyTrimBanked` check,
explicitly flags this exact cycle as the reason that duplication exists). Verified safe here:
both functions are plain function declarations (hoisted) used only inside other function bodies,
never evaluated at module top-level, so the cycle resolves correctly regardless of which module
finishes initializing first — confirmed empirically (both affected test files run clean, see
Evidence) rather than assumed.

**Deliberately left unchanged:** every other `deckStatus` (WATCH/OPEN/HOLD/TRIM/CLOSED) — a
genuine open position (desk actively telling a member to hold a real, live trade) still reads
"HOLD" verbatim in both bullets, exactly as before. Not touched: `play-brief.ts`'s own three
already-fixed call sites (#6532), `swingVerdictVerb`'s internal logic (reused, not modified), and
any other section of the brief.

### Evidence

New regression tests in `src/lib/swing/play-brief-narrative.test.ts`:

1. `"tradeManagerNarrativeSection: SKIP/RESEARCH candidate's 'Entry stance' line reads PASSED, not
   the overloaded HOLD recommendation (2026-10-21, follow-up to #6532)"` — a SKIP-status fixture
   (`recommendation: "HOLD"`, `swingEntryAction: undefined`) asserts the Entry stance bullet reads
   `"PASSED"` and never `"HOLD"`.
2. `"tradeManagerNarrativeSection: SKIP/RESEARCH candidate's degraded 'Live read' line reads
   PASSED, not HOLD (2026-10-21, follow-up to #6532)"` — same fixture, no `vector`/`ecosystem`
   (forces `spot == null` so `degradedReadLine` fires), asserts `"desk still says **PASSED**"`.
3. `"tradeManagerNarrativeSection: a genuine OPEN/HOLD position's 'Live read' line still reads
   HOLD, unaffected by the SKIP fix (2026-10-21)"` — scoping proof: a real `status: "HOLD"`
   position still reads `"HOLD"` verbatim.

RED → GREEN proof: saved the source diff (`play-brief.ts` + `play-brief-narrative.ts`) to a patch
file, reverted both source files to pre-fix (test file untouched), re-ran
`play-brief-narrative.test.ts` — tests 1 and 2 above failed exactly as expected (`got: •
**Entry stance** — HOLD. ...` / `desk still says **HOLD**`), test 3 (already-correct behavior)
passed. Re-applied the patch — all 146/146 tests in the file GREEN, including the 3 new ones.

Full verification (Node 20, `--experimental-test-module-mocks`):
- `src/lib/swing/play-brief-narrative.test.ts`: 146/146 GREEN.
- `src/lib/swing/play-brief.test.ts`: 169/169 GREEN (confirms the new circular import — see Fix —
  does not break the file that already imports FROM `play-brief-narrative.ts`).
- `npx tsc --noEmit` (whole project): clean.
- Full suite (`npm test`, every `*.test.ts` under `src/` + `scripts/`): GREEN, 0 failures (see PR
  for the exact count at merge time).

### Blast radius

Scoped to exactly these two call sites, both named explicitly by #6532's own finding. No other
file reads the overloaded `recommendation`/`swingActionDisplay`/`swingEntryAction` chain for a
SKIP row in a way that reaches member-facing copy — `play-brief.ts`'s three sites were already
fixed by #6532 itself. `swingVerdictVerb`'s export is additive (no existing caller's behavior
changes); the new import edge (`play-brief-narrative.ts` → `play-brief.ts`) is the one structural
change beyond the two bullets themselves, verified safe per the Fix section above.

### Verify

`npx tsc --noEmit` clean. `play-brief-narrative.test.ts` 146/146 GREEN, `play-brief.test.ts`
169/169 GREEN, both Node 20 with `--experimental-test-module-mocks`. Full `npm test` GREEN.
