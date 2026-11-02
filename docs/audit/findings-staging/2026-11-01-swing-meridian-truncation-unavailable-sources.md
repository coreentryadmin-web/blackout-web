> **kind:** FINDING

## Meridian earnings-window truncation disclosed in narrative but never reaches envelope.unavailableSources (Largo C3) — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-absence.ts`, `collectBriefUnavailableSources`) |
| **Severity** | P3 (absence-channel correctness — the structured chip surface disagrees with the brief's own prose) |
| **Status** | FIXED |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — deep-dive workflow `wf_dde7f6a4-a27`, 2026-11-01, independently confirmed on two different tickers (TSM, PANW), adversarially verified |

### What was broken

PR #7154 (2026-10-31/11-01) added `window_truncated` to `SwingMeridianCatalystSlice` — set when
the market-wide Benzinga earnings-window fetch feeding `ctx.meridian` hits its own pagination
safety cap with pages still remaining upstream — and wired it into the **narrative**
(`meridianCatalystSection`/`meridianPeerSection` in `play-brief-intel.ts`), which correctly render
an honest "cannot confirm — truncated" caveat instead of the old, wrong "calendar is quiet" claim.

That PR never touched `play-brief-absence.ts`'s `collectBriefUnavailableSources` — the **sole**
feeder of `envelope.unavailableSources`, the one place the UI's `UnavailableChip` and the model's
structured absence channel (Largo product contract C3) read from. So the chip row silently
disagreed with the narrative two sections away.

Live-confirmed on two separate tickers:

- **TSM** (WATCH): "Meridian catalysts" and "Earnings peer lens" both render "cannot confirm —
  truncated" in prose, but `envelope.unavailableSources` lists 9 other sources and no Meridian
  entry; `confidence.why` undercounts the true absence state to match.
- **PANW** (CLOSED): same split — narrative discloses truncation, `unavailableSources` has exactly
  one entry ("GEX gamma flip") and no Meridian entry at all.

A reader consulting only the structured channel would wrongly conclude the Meridian catalyst/peer
read for these tickers is trustworthy — exactly the split the Largo product contract's C3 (absence)
principle forbids: "No data and no signal are different claims. A consumer that cannot tell them
apart will report absence as a finding."

### Root cause

`collectBriefUnavailableSources` only ever checked `ctx.meridian?.unavailable` (total fetch
failure) and `meridianCatalystStale(ctx.meridian, readMs)` (aged read) — never
`ctx.meridian?.window_truncated`, a real, populated, independent absence signal of the identical
shape.

### Fix

Added a third branch: when `window_truncated` is true **and** this ticker has no confirmed items
(`!ctx.meridian.items.length`), push a "Meridian catalysts" absence entry. Gated on `!items.length`
to match `meridianCatalystSection`'s own gate on its truncation caveat exactly — a ticker whose row
WAS found before the fetch hit its cap has a genuinely confirmed read, so truncation elsewhere in
the market-wide window is irrelevant to this ticker's own already-known items.

### Blast radius

Single call site. `confidence.why`'s unavailable-source count/list is derived from the same
`collectBriefUnavailableSources` output, so it is fixed automatically — no separate change needed.
The unrelated "Meridian peer cohort" absence check a few lines below (driven by `ctx.meridianPeer`,
a different field covering the implied-move ranking cohort) was untouched.

### Tests

`src/lib/swing/play-brief-absence.test.ts`: two new tests — a truncated fetch with zero confirmed
items for the ticker surfaces the new absence entry; a truncated fetch where the ticker's own
items WERE confirmed does not.

RED→GREEN verified via `git stash push -u -- src/lib/swing/play-brief-absence.ts` (fix only, tests
kept): the new positive-case test failed exactly as predicted (`expected: true, actual: false`);
restoring the fix passes all 115 tests in the file. `tsc --noEmit` clean; sibling
`play-brief.test.ts`/`play-brief-intel.test.ts` (548 tests) unaffected.

### PR

`fix/swing-meridian-truncation-unavailable-sources`
