> **kind:** FINDING

## HELIX tape "Ask%" column rendered a genuine 0% print as absent data — FIXED

**Status:** FIXED (round 295, discovery-lane audit)

### Root cause

`fmtAskPct` (`src/features/helix/lib/helix-flow-format.ts`) formats the HELIX live-tape's `Ask%`
cell from `flow.ask_pct`, a 0-100 **share** of a print's premium filled at or above the ask
(documented on `MinimalFlow.ask_pct` in `helix-signal-detection.ts`: *"Ask-side share of premium
(0-100)"*). The guard was:

```ts
if (pct == null || !Number.isFinite(pct) || pct <= 0) return "—";
```

`pct <= 0` folds a genuine, maximally seller-initiated `ask_pct === 0` print into the same "—"
no-data glyph used for a print that carries no ask-side reading at all. 0% is not an edge case
nobody expects — it is the single most seller-aggressive value the field can report (100% of the
print's volume filled at or below the bid) — and the rest of this exact lane already knows that:

- `aggressorSide` (`helix-flow-aggression.ts`): `askPct == null` is the absence check; `askPct <= ASK_SIDE_SOLD_PCT (40)` — true at 0 — correctly reads `"sold"`.
- `executionQualityBucket` (`helix-execution-quality.ts`): same `askPct == null` absence check; `askPct <= 40` — true at 0 — correctly buckets `"passive"`.
- `HelixFlowTable.tsx`'s own `ask` cell computes **both** `askPctTone(flow.ask_pct)` (the cell's colour, via `executionQualityBucket`, correctly reading 0 as real/passive) **and** `fmtAskPct(flow.ask_pct)` (the cell's text) from the identical `flow.ask_pct` value, one line apart.

So for a real 0% print, the tape rendered a **red-tinted cell containing the text "—"**: the
colour asserted a measured, bearish-leaning read while the text in the same cell asserted no
measurement existed at all. A member (or Largo reading the same field) cannot tell "this print
was 0% at ask" from "we have no ask-side reading for this print" from the rendered text alone —
exactly the absence-vs-zero conflation this lane's own `fmtIv`/sector `callPct`/
`directionalPremium.undetermined` comments describe fixing elsewhere, just not yet caught here.

### Evidence

`fmtAskPct(0)` returned `"—"` before the fix; a new RED test (`fmtAskPct renders a genuine 0%
print, not absence`, `src/features/helix/lib/helix-flow-format.test.ts`) asserted `fmtAskPct(0)
=== "0%"` and failed against the pre-fix code (1 failing test, 29 passing) — confirmed by running
the suite before the fix. After the fix (`pct <= 0` → `pct < 0`), the full file's 30 tests pass,
including the pre-existing absence-handling test (`null`/`undefined`/`NaN`/negative still render
`"—"`).

### Blast radius

`fmtAskPct` has exactly one call site repo-wide (`HelixFlowTable.tsx`'s `ask` column renderer), so
the fix is contained to that one cell. No other formatter in `helix-flow-format.ts` shares this
exact defect for a field whose zero is meaningful: `fmtSpot`/`fmtFill`/`fmtIv` all guard `<= 0` on
fields where zero is never a real reading (a stock trades above $0, a fill price above $0/sh, and
IV is never literally 0 in practice) — those guards are correct as written and were not touched.
`fmtOi` (open interest) also guards `<= 0`, and `open_interest === 0` IS a real, meaningful value
(`helix-position-intent.ts`'s `positionIntent` explicitly branches on `oi === 0` as
`"no_open_interest"` — every lot on that strike is provably new) — this looks like the same bug
shape in a second field and is flagged as a lead for the next audit round rather than folded into
this fix, to keep this PR to the one root cause it has evidence for (this change doesn't touch
`fmtOi`, and no claim is made here about how often `open_interest === 0` is actually reachable on
the live tape vs. `ask_pct === 0`, which this fix's own cited docstrings already establish as a
genuine, non-theoretical value).

### Fix rationale

Narrowed the guard from `pct <= 0` to `pct < 0`. `ask_pct`'s documented range is 0-100, so a
negative value is still treated as invalid/out-of-range data (defensive, same as before for that
case), while `0` through `100` all render their real percentage. This is the minimal change that
makes `fmtAskPct` agree with every other reader of the same field on what counts as "no data" —
no behavior changed for any `ask_pct` value other than exactly `0`.
