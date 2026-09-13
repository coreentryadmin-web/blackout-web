> **kind:** FINDING

# `flow-polarity.ts`'s `bid_put_share_of_puts` measurement silently dropped credit for moderate ask_side_pct values

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `compareFlowPolarity` (`src/features/nighthawk/lib/flow-polarity.ts`) — a measurement-only research probe (does NOT feed live Legacy scoring) used by `scripts/audit/nighthawk-flow-polarity.mjs` (`npm run probe:nighthawk-flow-polarity`) and `nighthawk-evening-replay.mjs` to quantify how often Legacy's call/put-premium direction disagrees with a signed-aggression read, specifically to decide whether the disagreement rate ever justifies a real scorer change |
| **Severity** | P3 — no live product impact (the file's own header states "MEASUREMENT ONLY — it does not change Legacy scoring"), but the specific statistic this bug distorts (`bid_put_share_of_puts`, documented as "the classic misread bucket") is exactly the number `docs/audit/FINDINGS.md` cites as the gate for a future real scorer change ("No scorer change until measured rate justifies it") — a systematically under-counted measurement could mislead that eventual decision. |

## Root cause

`compareFlowPolarity`'s loop computes `bid_put_share_of_puts` for put rows whose `tradeSide()` classification is ambiguous (`null` or `"M"`) by falling back to the raw `ask_side_pct` field:

```ts
const askPct = Number(r.ask_side_pct);
if (Number.isFinite(askPct) && askPct <= 40) bidPutPrem += prem * ((100 - askPct) / 100);
else if (!Number.isFinite(askPct)) bidPutPrem += prem * 0.5;
```

This only credits a row's proportional bid-side share when `askPct <= 40`, or falls back to a 50/50 split when `askPct` is missing entirely. Any row with a **finite `askPct` strictly between 40 and 100** — e.g. `askPct = 45`, genuinely 55% bid-side — hits **neither** branch and silently contributes **zero** to `bidPutPrem`, even though it should contribute `prem * 0.55`.

This gap is not closed by `tradeSide()`'s own classification either: `tradeSide()` only returns `"A"` when `askPct >= 60`, so any row with `askPct` in `(40, 60)` returns `null` from `tradeSide()` (falling into the ambiguous branch above) and then gets dropped entirely by the `<=40` cutoff. The `(40, 60)` range — and in fact the whole `(40, 100]` range — was reachable and untested; no existing test in `flow-polarity.test.ts` exercised the `ask_side_pct` fallback path at all (every existing test drives rows via the discrete `trade_side: "A"/"B"` field instead).

`bid_put_share_of_puts` is documented as a **share** (a continuous 0–1 metric), and the sibling function `signedAggressionDirection` in the same file already treats `ask_side_pct` continuously (`askShare = askPct / 100`) — the discrete `<=40` cutoff here was inconsistent with both the stated semantics and the file's own established pattern one function up.

## Blast radius

`compareFlowPolarity` is the only consumer of this buggy branch (confirmed via grep — `bidPutPrem`/`bid_put_share_of_puts` are local to this one function). Its two script callers (`nighthawk-flow-polarity.mjs`, `nighthawk-evening-replay.mjs`) both just report whatever `compareFlowPolarity` returns; neither reimplements the calculation. No live/production code path is affected — this is a pure research-tool correctness fix.

## Fix

Replaced the `askPct <= 40` cutoff with the same continuous-share treatment used everywhere else `ask_side_pct` is consumed in this file: any finite `askPct` in `[0, 100]` now contributes its real proportional bid share (`(100 - askPct) / 100`); only a genuinely missing/non-finite `askPct` falls back to the 50/50 split.

## Why this fix, not an alternative

Considered leaving the `<=40` cutoff and instead widening `tradeSide()`'s own `>=60` "A" threshold to close the gap from the other side — rejected because `tradeSide()` is a shared helper (its own comment says it "mirrors scorer.ts's flowTradeSide field priority" to keep parity with live scoring semantics), so changing its classification threshold would risk touching code paths well beyond this one measurement function. Fixing the local proportional-credit computation is the minimal, contained change that matches the function's own documented "share" semantics.

## Evidence

- New test: a put row with only `ask_side_pct: 45` (no `trade_side`, so `tradeSide()` returns `null` and the ambiguous-branch fallback is exercised) must yield `bid_put_share_of_puts === 0.55`.
- RED: reverted `flow-polarity.ts` only (kept the new test) — failed exactly as predicted, `0 !== 0.55`.
- GREEN: restored the fix — 6/6 pass in `flow-polarity.test.ts`.
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14080/14083 pass, 0 fail, 3 skipped.

## What was deliberately left unchanged

`tradeSide()`'s own field-priority logic and its `>=60` binary thresholds (used for the DISCRETE "A"/"B"/"M" classification consumed elsewhere, including live scoring parity) are untouched — this fix only changes how the ALREADY-ambiguous (`null`/`"M"`) case computes its proportional share inside this one measurement function. `legacyCallPutDirection` and `signedAggressionDirection` are untouched; they were not affected by this gap.
