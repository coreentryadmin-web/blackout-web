> **kind:** FINDING

## Debrief thesis scorecard's "regime" factor read backwards for a contrarian play

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `buildThesisScorecard` (`src/features/nighthawk/lib/debrief.ts`) — the per-play post-mortem "thesis scorecard" persisted by `runNighthawkDebriefPass` (`debrief-persist.ts`) onto every graded Legacy row |
| **Severity** | P2 — a real outcome-honesty defect. No live UI currently renders this field, but it is the permanent, persisted audit record `debrief-persist.ts` writes for every graded play, and this session's own standing mandate is exactly "was the stated reasoning actually sound." A contrarian play that lost precisely because it fought the market got its regime factor recorded as "confirmed." |

### Root cause

The function's own docstring defines the regime factor as: *"the pinned evening regime/tide **supported this direction** AND the session moved that way."* Two conditions, joined by AND. The implementation only checked the second:

```ts
} else if (reference != null && close != null && close !== reference) {
  const sessionBias = close > reference ? "LONG" : "SHORT";
  factors.push({
    label: "regime",
    verdict: sessionBias === regimeBias ? "confirmed" : "refuted",
    ...
  });
}
```

This tests only "did the regime's own directional call come true" — it never checks whether `regimeBias` agreed with the PLAY's own direction (`isLong`) at all. Legacy does publish contrarian plays that fight the pinned regime (`play-critic.ts`'s `tideContradictsDirection` exists specifically to flag, not veto, exactly this case — "regime is a macro overlay, not a veto"). For such a play, when the market moves in the regime's predicted direction (i.e., against the play), the code reported the regime factor as `"confirmed"` — the opposite of what a thesis scorecard should say: the regime never supported this play's direction in the first place, and the play lost precisely because it disagreed with a regime call that turned out right.

Reproduced directly:

```ts
// SHORT published against a BULLISH pin; session rallies, stopping the SHORT out —
// exactly what the bullish pin predicted, and exactly why the SHORT lost.
debriefPlay(row({ direction: "SHORT", outcome: "stop", next_day_close: 110, publish_context: PIN /* bullish */ }))
// thesis.regime -> { verdict: "confirmed", ... }   (BEFORE the fix)
```

`direction` correctly read `"refuted"` for this same play (the SHORT lost) while `regime` read `"confirmed"` — two factors in the same scorecard directly contradicting each other's implied verdict on the same play.

### Blast radius

Only this one factor inside `buildThesisScorecard`. The `direction`, `entry_band`, and `catalyst` factors are untouched and already correctly test against the play's own direction. No live UI consumer exists today (grepped repo-wide — `debriefPlay`'s only caller is `debrief-persist.ts`, which persists the result; nothing currently renders `.thesis`), so this has no current member-facing symptom, but it corrupts the ground-truth audit record for every contrarian play graded going forward, and any future outcome-honesty tool or admin view built on this persisted data would inherit the wrong verdict.

### Fix

The regime factor now requires BOTH conditions the docstring already promises: the pinned regime must have supported the play's own direction (`regimeBias === playDir`), AND the session must have moved that way (`sessionBias === regimeBias`). Only when both hold does it read `"confirmed"`; otherwise `"refuted"` (when testable). The detail string now names the mismatch explicitly ("did not support the published SHORT direction") when the regime never aligned with the play, so the record explains itself rather than just flipping a verdict silently.

### Why this fix, not an alternative

Considered adding a distinct verdict value (e.g. `"contrarian"`) for the case where the regime opposed the play's direction from the start, rather than collapsing it into `"refuted"` — rejected as unnecessary complexity: the existing `verdict` type is a fixed three-value enum (`confirmed`/`refuted`/`untestable`) used consistently across all four factors, and "the regime did not support this play, and testing it further is moot" is accurately captured by `"refuted"` with an explanatory detail string, without widening the type for one factor.

### Evidence

- Reproduced directly via `debriefPlay`: a SHORT against a bullish pin that gets stopped out by a rally read `regime: "confirmed"` before the fix.
- New tests in `debrief.test.ts` cover both contrarian directions: the play loses AND the market matches the regime (previously mis-read as confirmed) and the play wins AND fights the regime (already correctly "refuted" before the fix, kept as a regression guard so the fix doesn't flip it).
- RED: reverted `debrief.ts` only (kept the new tests), 1/1 targeted assertion failed exactly as predicted (`contrarianLoss` regime verdict). The mirror case (`contrarianWin`) already passed under the old code by coincidence (sessionBias already disagreed with regimeBias there), confirming the fix is scoped to the exact gap described above.
- GREEN: restored the fix, all 36 tests in `debrief.test.ts` pass (34 pre-existing + 1 new test with 2 sub-cases... actually 2 new assertions within 1 new test, total test count 36 vs 35 before).
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14048/14051 pass, 0 fail, 3 skipped.

### What was deliberately left unchanged

The `direction`, `entry_band`, and `catalyst` factors — all three already test against the play's own direction (`isLong`) correctly and were not touched. The "untestable" gating (no pin, non-directional regime, no measurable close-to-close move) is unchanged; only the `confirmed`/`refuted` decision within the already-testable branch was corrected.
