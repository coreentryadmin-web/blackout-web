> **kind:** FINDING

## SPX Slayer `gexOpposed()` fabricates a +2 `weighted_conflicts` opposition bonus against SHORT setups off a desk-state combination that `computeSpxConfluence` never scores in either direction — FIXED

**Status:** Fixed, regression tests added (`src/features/spx/lib/spx-play-conflicts.test.ts`).

### Root cause

`computeSpxConfluence` (`src/features/spx/lib/spx-signals.ts`, ~L484-504) scores a `"γ regime"`
factor in exactly two cases, and no others:

```ts
if (regime === "mean_revert" && aboveFlip) {
  // +10, bullish — genuinely opposes a SHORT
} else if (regime === "amplification" && !aboveFlip) {
  // -10, bearish — genuinely opposes a LONG
}
```

`gexOpposed()` (`src/features/spx/lib/spx-play-conflicts.ts`) independently re-derives a desk-level
"is GEX opposed to this direction" signal from the raw desk fields (`gamma_regime`,
`above_gamma_flip`) — by design, so a conflict still counts even when mutual-exclusivity or other
rules kept it out of `factors` (see the companion #7114 fix, which this finding's own staged-finding
file explicitly — and wrongly — asserted `gexOpposed`'s regime detection was "correct"). But the
function defined ONE shared variable for both directions:

```ts
const regimeOpposed = desk.gamma_flip != null && desk.gamma_regime === "amplification";
if (direction === "long") {
  return (regimeOpposed && !desk.above_gamma_flip) || /* wall check */;
}
return (regimeOpposed && desk.above_gamma_flip) || /* wall check */;
```

The long branch correctly reduces to `amplification && !aboveFlip` — the real, scored bearish
condition. But the short branch reduces to `amplification && aboveFlip` (same `regimeOpposed`,
aboveFlip polarity flipped) — a combination `computeSpxConfluence` **never scores in either
direction**. It should instead mirror the real bullish condition, `mean_revert && aboveFlip`.

This state is not hypothetical — it is reachable on every live upward gamma-flip crossing:
`gammaRegimeWithHysteresis` (`src/lib/providers/gamma-desk.ts`), wired into every live
`gamma_regime` computation in `spx-desk.ts`, deliberately holds the regime label sticky at its
PREVIOUS value for a buffer around the flip crossing (to avoid flicker), while `above_gamma_flip`
is always computed fresh from raw `spot > flip` in the same builder. So right after spot crosses up
through the flip but before the buffer clears, `gamma_regime` still reads `"amplification"` while
`above_gamma_flip` is already `true` — exactly the state the short branch misread as opposition.

### Evidence

- **RED (pre-fix):** desk `{ price: 101, gamma_flip: 100, gamma_regime: "amplification",
  above_gamma_flip: true, gex_walls: [], tide_bias: "neutral", news_headlines: [], vix: 20 }`,
  `factors = [{ label: "Live tape", weight: -12 }]` (exactly what `computeSpxConfluence` would
  produce for this desk — no `"γ regime"` factor at all, since neither scored combination
  matches) — `computeWeightedConflicts(desk, -40, factors)` returned
  `{ conflicts: 0, weighted_conflicts: 2 }`, a fabricated +2 with zero real opposing factors.
  Confirmed via a temporary revert of the fix + test run (2 failing subtests), then restored.
- **GREEN (post-fix):** same input now returns `{ conflicts: 0, weighted_conflicts: 0 }`.
- Mirror regression (`mean_revert && aboveFlip`, the real bullish condition) still correctly fires
  `weighted_conflicts: 2` against the same short — proving the fix didn't just suppress the branch.
- Mirror regression on the LONG side (`amplification && !aboveFlip`, the real bearish condition)
  still correctly fires `weighted_conflicts: 2` — proving the already-correct long branch is
  untouched.
- Full `spx-play-conflicts.test.ts`: 13/13 pass (4 new tests added).
- `src/features/spx/lib/spx-play-conflicts.test.ts`, `spx-play-gates.test.ts`, `spx-signals.test.ts`,
  `spx-play-context.test.ts` together: 63/63 pass, no regressions.
- `npx tsc --noEmit`: clean.

### Blast radius

`weighted_conflicts` flows into: (1) `spx-play-gates.ts`'s `mixedTapeGateMessage`/
`mixedTapeBlockThreshold` (the "Tape's mixed — too many conflicting signals for clean entry" hard
BUY block) and `maxWeightedForEntryMode` (full vs starter vs no-entry sizing); (2)
`spx-play-context.ts`'s `buildSpxPlayDeskContext`, which recomputes the identical value into
`desk_context.mixed_tape_blocked`/`mixed_tape_threshold` shown to members and to Ask Largo; (3)
`spx-signals.ts`'s `computeSpxConfluence` and `reclassifyConfluenceScore`, which publish it as
`SpxConfluence.weighted_conflicts`/`conflicts`. Net effect: during the routine, frequent transient
window right after SPX ticks up through the gamma flip, every candidate SHORT setup absorbed a
phantom +2 conflict penalty with no real evidence behind it — enough to push a borderline short
over the mixed-tape block or demote it from full to starter (or no) entry size, purely as an
artifact of regime-label hysteresis. LONG setups were unaffected (confirmed via the mirror-case
test), so the pre-fix defect had a one-sided bias against short entries.

### Fix rationale

Split the single shared `regimeOpposed` variable into two direction-specific checks, each mirroring
its OWN correct branch of `computeSpxConfluence` exactly: the long branch keeps
`amplification && !aboveFlip` (already correct), and the short branch is corrected to
`mean_revert && aboveFlip` (the real bullish condition that genuinely opposes a short) instead of
reusing the amplification test with a flipped polarity. The `gamma_flip != null` guard (from the
2026-10-17 null-flip fix) is preserved on both branches. Rejected: removing the regime clause
entirely and relying only on the `gex_walls` proximity check — that would silently drop a real,
intentional desk-level signal `computeSpxConfluence` itself demonstrates is meaningful; the correct
fix is to make `gexOpposed` agree with the confluence engine's own definition of opposition, not to
remove the check.

### Deliberately left unchanged

- `gexOpposed`'s `gex_walls` resistance/support proximity checks — independent of
  `gamma_regime`/`gamma_flip`, derived from the strike ladder, not implicated by this bug.
- The `gamma_flip != null` null-guard — correct, orthogonal to this fix, preserved on both branches.
- The GEX/γ "already scored" double-count guard in `computeWeightedConflicts` (`gexAlreadyScored`,
  from #7114) — operates downstream of `gexOpposed`'s return value and is unaffected by which
  regime/aboveFlip combination `gexOpposed` itself tests.
- Note for future sessions: the 2026-11-01 staged finding for #7114
  (`2026-11-01-spx-gex-wall-conflict-wrong-guard.md`) asserts under "Deliberately left unchanged"
  that "`gexOpposed`'s own wall/regime detection logic — correct." That claim did not hold for the
  short-branch regime check this finding fixes; treat blanket "X is correct" notes in prior staged
  findings as claims to re-verify against current source, not as settled fact, per this repo's own
  standing staleness-trap guidance.
