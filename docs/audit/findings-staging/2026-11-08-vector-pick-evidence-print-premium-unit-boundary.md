> **kind:** FINDING

## Vector pick-evidence "Print at strike" premium formatter overflowed K at the $1M boundary instead of promoting to M — FIXED

| | |
|---|---|
| **Area** | Vector (`src/features/vector/lib/vector-pick-evidence.ts`) |
| **Status** | FIXED |
| **Severity** | P3 (display-only) |

### Root cause

`buildVectorPickEvidence`'s "HELIX flow" section renders a "Print at strike" evidence item for
every corroborating print at a Vector contract pick's strike, with its own inline dollar formatter:

```ts
value: `$${prem >= 1_000_000 ? `${(prem / 1_000_000).toFixed(1)}M` : `${Math.round(prem / 1000)}K`}`,
```

This picks the display unit (K vs M) by comparing the **raw** premium against the 1,000,000
threshold, then separately rounds the quotient for the K branch. A premium whose raw value sits
just under $1M but whose *rounded* K-quotient reaches 1000 falls through to the K branch and
overflows past its own unit: `premium = 999_600` → `prem >= 1_000_000` is `false` →
`Math.round(999_600 / 1000) = 1000` → renders `"$1000K"`, never promoting to `"$1.0M"`.

This is the exact "choose the display unit before rounding the quotient" unit-boundary bug class
already fixed in this codebase's shared money formatter, `fmt-money.ts`'s `fmtPremium` — which
rounds the quotient **first**, then checks whether the rounded value still fits the chosen unit,
promoting to the next unit when it doesn't (see that function's own header comment for the
identical `999_700`/`"$1000K"` repro it guards against). The twist here: `vector-pick-evidence.ts`
already imports `fmtPremium` from `@/lib/fmt-money` and uses it correctly for the *other* dollar
value in the same file (`strikeGex` → "Net GEX at strike", line 218) — but the "Print at strike"
value a few lines above it kept its own, separately-written, un-fixed inline formula instead of
reusing the already-correct shared helper sitting right there in the same import. Two
implementations of "format this premium compactly" in one file, only one of which had the fix.

### Evidence (RED → GREEN)

Added a regression test to `vector-pick-evidence.test.ts` asserting a corroborating print with
`premium: 999_600` at the pick's strike renders `"Print at strike"` as `"$1.0M"`.

RED (before the fix, `npx tsx --experimental-test-module-mocks --test
src/features/vector/lib/vector-pick-evidence.test.ts`):
```
not ok 4 - buildVectorPickEvidence: 'Print at strike' promotes a near-$1M print to M, never an overflowed 4-digit K
  Expected values to be strictly equal:
  + actual - expected
  + '$1000K'
  - '$1.0M'
# tests 6
# pass 5
# fail 1
```

GREEN (after replacing the inline formula with `fmtPremium(prem)`):
```
ok 4 - buildVectorPickEvidence: 'Print at strike' promotes a near-$1M print to M, never an overflowed 4-digit K
# tests 6
# pass 6
# fail 0
```

All 5 pre-existing tests in the file (including the `"2.6M"` print-at-strike case and the
aggressor-direction filtering tests) still pass unchanged. `npx tsc --noEmit` clean.

### Blast radius

The only consumer of this formula is the "Print at strike" item built inside
`buildVectorPickEvidence` itself — grepped for `"Print at strike"` across `src/` and the only
other hits are the test file's own assertions, already updated. No other call site duplicates this
exact inline formula, so this is a single-location fix (unlike the sibling K→M fixes already landed
this session in `fmt-money.ts`, `thermal-discord-card.ts`, `darkpool-discord-format.ts`,
`discord-context-enrichment.ts`, `helix-flow-format.ts` and `group-greek-flow-summary.ts`, which
each had their own independent copy of the bug — this one was a *reuse* gap, not a new copy of the
formula).

### Fix rationale

Replaced the inline ternary with a call to the already-imported, already-correct `fmtPremium`
(from `@/lib/fmt-money`) — the same helper this exact file already trusts for its other dollar
value. This removes a second, divergent implementation of "format a premium compactly" rather than
hand-patching the inline formula's own rounding order, so the "Print at strike" value now shares
every future fix `fmtPremium` gets (e.g. its billions branch, already present and otherwise unused
by this file) instead of needing its own sweep next time. Deliberately left the "Session tape"
calls/puts-in-millions line (`Math.round(flowSummary.callPremium / 1_000_000)`) untouched — that
value is always expressed as whole millions with no K branch to overflow, so the same bug class
cannot reach it.
