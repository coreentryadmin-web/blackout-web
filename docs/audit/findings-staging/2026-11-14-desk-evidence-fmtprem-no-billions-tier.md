## Night Hawk desk-evidence HELIX tape line's local `fmtPrem` formatter had no billions tier and no round-first-then-promote guard at the K->M boundary — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk 0DTE thesis desk-evidence stack — `src/lib/zerodte/thesis/desk-evidence-lines.ts` (display-only helper; no decision/scoring logic touched) |
| **Status** | FIXED (PR, round 530) |
| **Severity** | P3 — display-layer only, no trading/data impact |

### Root cause

`desk-evidence-lines.ts`'s `formatHelixLine` builds the member-facing "HELIX" evidence line on
the 0DTE thesis desk-evidence stack (the `DeskEvidenceStack.tsx` / `ThesisRankCard.tsx` row that
says, e.g., `"$2.1M tape · 6 prints · call-side bias · ..."`). It rendered the tape aggregate
through a local, un-exported `fmtPrem(n)` helper instead of importing the canonical shared money
formatter (`fmt-money.ts`'s `fmtPremium`, or any of the already-fixed sibling formatters this
session: `thermal-discord-card.ts`'s `fmtCompactHeatMoney`, `zerodte-board-format.ts`'s
`fmtMoney`, `vector-crosshair-format.ts`'s `fmtGex`, `meridian-revenue-format.ts`'s
`fmtCompactRevenue`, among others). The drifted duplicate was:

```ts
function fmtPrem(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
```

Two compounding defects, both reachable with real production data:

1. **No billions tier at all.** The value this renders — `extras.helix_gross_premium` — comes
   from `aggregateHelixTapeByTicker` (`helix-tape-extras.ts`), which SUMS every real
   `flow_alerts` premium for a ticker across the scan window with **no upper bound** (only a
   `$200,000` *lower* display floor gates whether the line shows the tape at all —
   `formatHelixLine`'s `if (prem != null && prem >= 200_000)`). A busy ticker's aggregate tape —
   SPY/SPX/NVDA on an active day, or any name mid-accumulation — routinely clears $1B. Any such
   aggregate rendered a raw, unpromoted four-plus-digit `M` label, e.g. `"$1500.0M"` instead of
   `"$1.5B"`.
2. **Round-after-pick at the K->M boundary.** `Math.round(n / 1_000)` picked the K unit off the
   RAW value and rounded the quotient with no re-check, so an aggregate that rounds UP to 1000 of
   the K unit (e.g. `999_600` → `Math.round(999.6)` = `1000`) rendered the overflowed `"$1000K"`
   instead of promoting to `"$1.0M"` — the exact round-first-then-promote defect shape already
   fixed repeatedly elsewhere in this repo this session, missed here because this is a separate
   drifted copy rather than an import of the canonical helper.

This function is purely a display formatter for evidence-line TEXT (no score/gate/bias decision
reads or writes it) — the fix below touches only `fmtPrem` itself; `fmtStrike`, `biasStatus`,
`railAligned` and every other decision-adjacent helper in this file are untouched.

### Evidence

Added two regression tests to `desk-evidence-lines.test.ts`, exercised through the public
`buildDeskEvidenceLines` entry point (`fmtPrem` itself is not exported):

- `helix_gross_premium: 1_500_000_000` — pre-fix the HELIX line's text contained the literal
  `"$1500.0M"`; post-fix it contains `"$1.5B"`.
- `helix_gross_premium: 999_600` — pre-fix the HELIX line's text contained the literal
  `"$1000K"`; post-fix it contains `"$1.0M"`.

Proved RED → GREEN via `git stash` isolation of just the source fix (test file kept), confirming
the bug actually existed pre-fix rather than asserting the fix in isolation:

```
--- RED (pre-fix, fmtPrem unchanged) ---
# fail 2
not ok: ... HELIX tape premium promotes billions ...
  actual: '$1500.0M tape · call-side bias · quality sweep · CAMPAIGN'
not ok: ... HELIX tape premium rounds-then-promotes at the K->M boundary ...
  actual: '$1000K tape · call-side bias · quality sweep · CAMPAIGN'

--- GREEN (post-fix) ---
# pass 7
# fail 0
```

Full suite (Node 20, `npm test` via `scripts/run-tests.mjs`) and `npx tsc --noEmit` both clean
post-fix — see PR for the exact counts.

### Fix

Rewrote `fmtPrem` to match the canonical round-first-then-promote shape already shipped across
this repo's sibling formatters (e.g. `zerodte-board-format.ts`'s `fmtMoney`, directly adjacent to
this module in the Night Hawk feature tree): compute each candidate unit's rounded magnitude
*before* deciding whether it crossed into the next tier, promoting when it did, and add the
missing billions tier.

```ts
function fmtPrem(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) {
    const m = Math.round((n / 1_000_000) * 10) / 10;
    if (m >= 1000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    return `$${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = Math.round(n / 1_000);
    if (k >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k}K`;
  }
  return `$${Math.round(n)}`;
}
```

### Blast radius

Single call site (`fmtPrem(prem)` inside `formatHelixLine`), single file. No other function in
`desk-evidence-lines.ts` references `fmtPrem`. Did not touch `fmtStrike` (a strike-price
formatter, unrelated bug shape) or any decision/scoring logic (`biasStatus`, `railAligned`,
`deskEvidenceStatusLabel`) in the same file — those are out of scope for this fix and were
verified unaffected by the regression tests above (all pre-existing tests still pass unchanged).

### Note on a related, already-closed candidate in the same bug class

This sweep also re-examined `vector-pulse.ts`'s local `fmtPremium` (fixed for the identical bug
class in round 516, per `FINDINGS.md`'s "Vector Pulse flow-print premium formatter..." entry).
That fix deliberately left its own K-tier branch unguarded, because `flowAlertToPulseSignal`'s
only call site gates every input to `fmtPremium` on `flow.premium >= FLOW_MIN_PREMIUM`
(`$1,000,000`) with no path ever reaching the K branch — i.e. the K->M boundary there is
genuinely dead code, not a reachable live defect, so no further fix was made there this round.
