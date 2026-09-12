> **kind:** FINDING

# Night Hawk Legacy thesis: "positioning" scoring driver never named WHICH evidence drove it

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | Legacy overnight-digest thesis text (`buildDeterministicThesis`, `deterministic-edition.ts`) |
| **Severity** | P3 — narrative completeness gap, not a correctness bug |

## What was missing

`buildDeterministicThesis` can publish a card with `key_signal` reading e.g. `"BULLISH —
positioning + flow · score 78 (A)"`, but until this fix the thesis prose only ever surfaced ONE
narrow slice of positioning evidence — dealer greek-flow bias, printed unconditionally whenever
`pos_score >= 8` regardless of whether "positioning" was even a top-2 `key_signal` driver — and
never touched the three OTHER data sources `scoreOptionsPositioning` (`scorer.ts`) blends into
`pos_score`: dark-pool prints (worth up to 6 points), repeated/stacked strike accumulation (up to
7 points), and aligned OI growth (2 points, now live again after this session's #4839 fix). A
member reading "positioning" as a named driver had no way to tell whether that meant dark-pool
buying, stacked call accumulation, rising OI, or nothing narratable at all — the exact "signal
exists but isn't surfaced" gap class this session already fixed for "news" (#4821) and
"smart-money" (#4827).

This is the same fix pattern applied to a third `key_signal` driver: `pickCatalystHeadline` for
news, `smartMoneyDriverNote` for smart-money, and now `positioningDriverNote` for positioning.

## Fix

Added `positioningDriverNote(dossier, isLong)`, checked in the same priority order
`scoreOptionsPositioning` weighs its inputs (dark-pool up to 6pts, strike stacks up to 7pts,
OI-change 2pts), so the note names whichever source is likeliest to be doing the real work:

1. Dark-pool prints, when `dossier.dark_pool.bias` agrees with direction and total premium is at
   least $5M.
2. Strike-stack accumulation (`same_strike_accumulation` preferred over plain `repeated_hits`),
   filtered to the direction-aligned option side.
3. Rising aligned open interest (reusing the same `kind`-field convention #4839 fixed in
   `scoreOptionsPositioning` itself, so this note can't independently regress the same bug).

Wired in as `Positioning: <note>.` in the thesis, gated on `topDrivers.some(d => d.label ===
"positioning")` — the same `topDrivers` gate `key_signal` itself uses — and coexists with (does
not replace) the existing unconditional dealer-greek-flow line, since dealer flow is a genuinely
different, independent data source.

## Evidence

- RED: stashed the `deterministic-edition.ts` change, ran `deterministic-edition.test.ts` — 3
  failures (the dark-pool, strike-stack, and OI-change positive-evidence tests; the two
  negative-evidence "stays quiet" tests pass trivially either way, as expected).
- GREEN: restored the fix — 60/60 pass.
- `npx tsc --noEmit`: clean.
- Full suite (`npm test`, Node 20): 13868 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

The existing dealer-greek-flow line (`Dealer positioning <bias>.`, gated on `pos_score >= 8` alone,
not on `topDrivers`) is untouched — it is a separate, already-shipped piece of evidence from a
different data source (dealer delta/gamma flow, not dark-pool/strike-stack/OI print evidence), so
removing or merging it would be unrelated scope creep on a purely additive narrative fix.
