> **kind:** FINDING

## HelixContextHeader rendered "PCR" as put premium's share of total, not the put/call ratio — FIXED

**Area:** `src/features/helix/components/HelixContextHeader.tsx` (HELIX desk, ticker-scoped sticky
context header — `C $x · P $y · PCR z%` line).

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — one mislabeled/wrong-magnitude number on a member-facing panel, not a data-integrity or trading-logic defect |
| **Branch / PR** | `fix/helix-context-header-pcr-formula` |

### Root cause

`HelixContextHeader`'s render body computed its "PCR" chip inline as:

```ts
const pcr =
  summary.callPremium + summary.putPremium > 0
    ? summary.putPremium / (summary.callPremium + summary.putPremium)
    : null;
...
{pcr != null ? ` · PCR ${(pcr * 100).toFixed(0)}%` : ""}
```

That is **put premium's share of total premium** — a quantity bounded to 0-100%, reading "PCR 50%"
on a perfectly even call/put split. Every other place in this codebase that computes and renders a
field named `pcr` (or its `P/C` abbreviation) uses the standard, industry convention — **put
premium ÷ call premium**, a ratio typically quoted around 1.0 (e.g. 0.65, 1.20), not a percentage:

- `src/lib/providers/unusual-whales.ts` (3 call sites, dark-pool `pcr`): `callPrem > 0 ? Math.round((putPrem / callPrem) * 100) / 100 : null`
- `src/lib/bie/spx-desk-brief.ts`: reads the same field and gates its own copy on `pcr > 1.1` (bearish) / `pcr < 0.9` (bullish) — thresholds that only make sense around a ratio of 1.0, never a percentage.
- `src/features/meridian/components/MeridianEarningsIntelPanel.tsx`: ``P/C ${intel.dark_pool.pcr.toFixed(2)}``.

So the exact same label — "PCR" — meant two different, disagreeing quantities depending on which
panel on the site a member was reading: the dark-pool/SPX-desk/Meridian readers all show a ratio
near 1.0, while HELIX's own context header showed a percentage near 50%. A member who learned the
convention from one panel (PCR > 1.1 = bearish) would misread HELIX's header the same way and be
wrong by roughly a factor of 2 at the boundary (the header's old "50%" is the ratio-world's "1.00";
its "67%" is the ratio-world's "2.00").

This is the same "one field, many readers, silently disagreeing" failure shape this lane's own
`helix-direction-read.ts` and `helix-flow-aggression.ts` module headers document at length for
*direction* — this is the identical failure for a second shared financial field, PCR, that simply
had not been checked yet.

### Evidence

- `grep -rn "pcr" src` (excluding tests) turns up 5 independent call sites: 3 in
  `unusual-whales.ts`, 1 in `spx-desk-brief.ts` (plus its own bull/bear thresholding on the value),
  1 in `MeridianEarningsIntelPanel.tsx` — all five agree on `putPremium / callPremium`. Only
  `HelixContextHeader.tsx` disagreed, computing `putPremium / (callPremium + putPremium)` instead.
- Regression test added to `HelixContextHeader.test.ts`: an even $50k call / $50k put split
  asserts `pcr === 1` (true ratio) where the old formula would have produced `0.5` ("PCR 50%"); a
  $100k call / $200k put split asserts `pcr === 2` where the old formula would have produced
  `0.667` ("PCR 67%"). Confirmed RED against the pre-fix component (ran the new test with
  `git stash` isolating just the `.tsx` change — `undefined !== 1`, since `pcr` didn't even exist
  on the summary object before this fix) and GREEN after.

### Blast radius

Single call site. `summarizeHelixTapeContext`/`HelixTapeContextSummary` (the only export this
component's PCR logic lives in) has no other consumers in the repo
(`grep -rn "summarizeHelixTapeContext\|HelixTapeContextSummary" src` outside this file and its own
test returns nothing) — the inline, un-exported `pcr` constant inside the component body was the
only place this formula existed, so there is no second copy elsewhere to fix.

### Fix rationale

Moved the PCR computation into the already-exported, already-tested `summarizeHelixTapeContext`
pure function (as a new `pcr` field on `HelixTapeContextSummary`), using the exact same formula and
rounding `unusual-whales.ts`'s dark-pool `pcr` already uses — `callPremium > 0 ? Math.round((putPremium / callPremium) * 100) / 100 : null`
— so this is now the SAME derivation as every other "PCR" on the site, not a fourth reimplementation
with its own rounding. The render site was updated to display it as a ratio (`PCR z.zz`, matching
`spx-desk-brief.ts`'s `n(pcr, 2)` and Meridian's `.toFixed(2)`) instead of a percentage. Deliberately
left unchanged: the rest of the header (spot/IV/DTE/score chips) and every other panel's own
independent metrics — this fix only touches the one mislabeled quantity.
