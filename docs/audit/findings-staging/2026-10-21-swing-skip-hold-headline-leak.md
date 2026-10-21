## 2026-10-21 — [FINDING, P1 Ask Largo x Night Hawk Swings / Largo product contract] RESEARCH/SKIP swing candidates (desk is passing, no entry) render "HOLD" as the headline/thesis/Verdict verb, one sentence from text saying the setup was never entered — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### Symptom

Live `GET /api/market/swing/play-brief` (production, 2026-10-21): a RESEARCH/SKIP-status swing
candidate — the desk has decided NOT to enter it, no trade exists — has its `envelope.headline`,
`envelope.thesis`, and Verdict-section body all show the literal word **"HOLD"** as the single most
prominent word in the brief, one sentence away, in the SAME section, from text saying the desk is
passing on it entirely with no entry.

Reproduced on 2 independent tickers, both RESEARCH-bucket:

- **META**: `envelope.headline = "HOLD — META 705P 5DTE"`; `envelope.thesis = "SHORT META 705P 5DTE
  — HOLD · Event-driven directional."`; Verdict body:
  ```
  **META 705P 5DTE** · SHORT · HOLD

  Archetype: Event-driven directional

  Desk is passing this setup — no entry recommended.
  ```
- **ORCL**: `envelope.headline = "HOLD — ORCL 131C 9DTE"`; `envelope.thesis = "LONG ORCL 131C 9DTE
  — HOLD."`; Verdict body:
  ```
  **ORCL 131C 9DTE** · LONG · HOLD

  Desk is passing this setup — no entry recommended.
  ```

A trader skimming only the headline reasonably reads "HOLD — META 705P 5DTE" as an existing
position to keep holding, not a never-entered candidate being skipped — a genuine Largo-contract
identity/precision violation (`docs/audit/LARGO-PRODUCT-CONTRACT.md`), not cosmetic. Systemic to
every ticker currently sitting in the RESEARCH section of the swing board, not a single-ticker
fluke — confirmed on 2 independently-reproduced tickers hitting the exact same code path.

### Root cause

`swingEntryVerdict()`'s RESEARCH-section branch (`src/lib/swing/entry-verdict.ts`, around lines
260-291) returns:

```ts
return {
  deckStatus: "SKIP",
  recommendation: "HOLD",
  recNote: "Desk is passing this setup — no entry recommended.",
  gateBlocks: [...],
  actionLabel: null,
  entryAction: "dont_buy",
};
```

`recNote` is the correct, honest, member-facing sentence. But `SwingEntryVerdict.recommendation` is
typed `"BUY" | "HOLD"` — a two-value field with no distinct "pass"/"skip" value of its own — so the
RESEARCH branch reuses the literal string `"HOLD"` to mean "no BUY signal," not "hold an existing
position." Nothing about that field distinguishes the two meanings downstream.

`swingActionDisplay()` (`src/features/nighthawk/command-deck/play-card-lifecycle.ts`, line 312)
deliberately returns `null` for `play.status === "SKIP"`, specifically so the honest "PASSED"
lifecycle pill shows on the Command Deck instead of a fabricated action label (see that function's
own doc comment, lines 217-236: "SKIP RENDERS 'PASSED', NOT 'FAILED'... nothing was ever bought, so
nothing could fail").

`src/lib/swing/play-brief.ts` built the headline, `thesis`, and Verdict-section opening line off the
identical fallback chain in three places (`briefThesis`'s `verb`, line ~91; the Verdict line, ~1866;
the envelope headline, ~2066): `action?.label ?? play.recommendation ?? play.status`. For a SKIP
row, `action` is `null` (per the above), so the chain falls straight through to the literal
`"HOLD"` string on `play.recommendation` — never reaching `play.status` ("SKIP") and never reading
`recNote` at all for this purpose. An earlier fix (2026-09-10, SLV repro) made the Verdict line
agree with the headline — both correctly fell back through the SAME chain — but that fix never
questioned whether "HOLD" was the right word for this case to begin with; it just made the
contradiction consistent instead of removing it.

### Fix

Added `swingVerdictVerb(play, action)` (`src/lib/swing/play-brief.ts`, next to `briefThesis`), the
single shared resolver for all three render sites:

```ts
function swingVerdictVerb(play: TerminalPlay, action: { label: string } | null): string {
  if (play.status === "SKIP") return "PASSED";
  return action?.label ?? play.recommendation ?? play.status;
}
```

`"PASSED"` is not an invented label — it is the engine's own already-shipped vocabulary for this
exact decision (`playStatusDisplay`'s SKIP case, `play-card-lifecycle.ts`: "PASSED is the engine's
own vocabulary for the decision, and a discipline the desk should look good for exercising rather
than be punished for"). Reusing it keeps the Command Deck pill and the Ask Largo brief in agreement
instead of inventing a second, competing word for the same state.

All three call sites that used to inline the raw fallback chain now call `swingVerdictVerb`:
`briefThesis`'s `verb` (feeds `envelope.thesis`), the Verdict section's opening line
(`**{headline}** · {direction} · {verb}`), and the envelope `headline` (`{verb} — {headline}`) — the
task's root-cause trace explicitly named both the headline and Verdict-section construction as
needing the identical fix, and `thesis` shares the exact same chain (`briefThesis`'s own pre-existing
doc comment already states this), so fixing the one shared function fixes all three together and
they can never drift apart again.

**Deliberately left unchanged:** every other `deckStatus`. `play.status` is never `"SKIP"` for
WATCH/OPEN/HOLD/TRIM/CLOSED, so those branches fall through to the identical, untouched
`action?.label ?? play.recommendation ?? play.status` chain — a genuine OPEN/HOLD position (desk
actively telling a member to hold a real, live trade) still reads "HOLD" exactly as before. Proven
by a dedicated regression test (below) rather than asserted.

### Evidence

New regression tests in `src/lib/swing/play-brief.test.ts`:

1. Rewrote the existing `"composeSwingPlayBrief: SKIP-status Verdict line agrees with the envelope
   headline, not raw status (2026-09-10 gap fix)"` test — it previously *asserted* the buggy
   `"HOLD"` output as correct (it only checked headline/Verdict *agreed*, not that the word itself
   was honest). It now asserts the corrected `"PASSED"` output and explicitly asserts the headline
   must NOT start with `"HOLD — "`.
2. New test `"composeSwingPlayBrief: a genuine OPEN/HOLD position still reads HOLD, unaffected by
   the SKIP fix"` — an `OPEN` + `recommendation: "HOLD"` fixture still renders `"HOLD — ..."` in the
   headline/thesis/Verdict line, proving the fix is scoped to SKIP only.

RED → GREEN proof: isolated the SOURCE change only via `git stash push -u -- src/lib/swing/play-brief.ts`
(test file untouched), re-ran the suite — the rewritten SKIP test failed exactly as expected
(`The input did not match /^PASSED — /. Input: 'HOLD — INTC 90C 13DTE'`), while the new OPEN/HOLD
test and all 167 other tests in the file still passed. Restored the fix via `git stash apply`
(then dropped the stash entry) — full suite GREEN again, 169/169.

### Blast radius

The identical fallback-chain pattern (`swingActionDisplay(play)?.label ?? play.swingEntryAction?.toUpperCase()
?? play.recommendation` / `?? "HOLD"`) also appears in `src/lib/swing/play-brief-narrative.ts`
(`actionNarrative`'s "Entry stance" line, ~line 655/662, feeding the "Trade manager read" section;
and a second "Live read" call site, ~line 1347) and would leak the same literal "HOLD" for a SKIP
row for the same reason (`swingActionDisplay` null, `swingEntryAction` always null for SKIP per
`adapters.ts` line 908's `"buy" | "still_buy"` narrowing). **Deliberately NOT fixed in this PR** —
not reproduced in the live evidence this finding is based on (only headline/thesis/Verdict were
confirmed live), and fixing it is a separate, clearly-scoped follow-up rather than widening this
PR's blast radius beyond the three root-caused, live-confirmed render sites. Flagged here so a
follow-up PR can pick it up without re-discovering it.

### Verify

`npx tsc --noEmit` clean. `src/lib/swing/play-brief.test.ts` 169/169 GREEN (Node 20,
`--experimental-test-module-mocks`). Sibling files sharing the touched call paths also GREEN:
`src/lib/swing/entry-verdict.test.ts`, `src/features/nighthawk/command-deck/play-card-lifecycle.test.ts`,
`src/lib/swing/play-brief-narrative.test.ts` (222 tests combined, 0 failures).
