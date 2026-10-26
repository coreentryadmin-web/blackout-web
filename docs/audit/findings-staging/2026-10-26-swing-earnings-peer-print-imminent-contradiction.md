> **kind:** FINDING

## Swing "Earnings peer lens" — "print imminent" bullet contradicts its own no-exposure sentence — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Date** | 2026-10-26 |
| **Lane** | Ask Largo / Night Hawk Swings standing mandate |
| **Live repro** | MSFT, CLOSED position #47 |
| **Surfaced by** | Background adversarial-verification workflow (3/3 independent confirmations, one with a direct repro run against the live source) |

### Root cause

`meridianPeerEarningsCoaching()` (`src/lib/swing/play-brief-meridian-peer-core.ts`) pushes an
unconditional `"**print imminent** — vol crush risk elevated"` bullet whenever
`item.days_until <= 3`, with no awareness of whether the reviewed position's own contract is
still alive by the print date (the function is deliberately pure/play-unaware).

A 2026-10-25 fix (live repro OUST, `SWING:OUST:2127`) already closed *half* of this exact
contradiction class: at the section-assembly layer (`meridianPeerSection()`,
`src/lib/swing/play-brief-intel.ts`), when `noGapExposure` is true (the position's own contract
expires strictly before the earnings date), the function swaps out the *trailing*
`EARNINGS_PEER_SIZING_INSTRUCTION` sentence ("size down or hedge vol...") for an honest
"no earnings-gap exposure from this position" sentence. But that fix's own regression test used
`days_until: 9`, so it never exercised the `days_until <= 3` branch — and the earlier "print
imminent — vol crush risk elevated" bullet, gated on that same `<=3` threshold, was left
untouched.

Live MSFT CLOSED brief (#47) showed both halves fire together in the SAME sentence group:

> "**Earnings peer lens** — reports in **3d** · **print imminent** — vol crush risk elevated.
> This contract expires 2026-10-09, on/before the print, so no earnings-gap exposure from this
> position..."

An active, live vol-crush risk warning immediately followed by an explicit no-exposure
disclosure about the identical print/contract — opposite risk conclusions in the same brief.

### Fix

Exported the "print imminent" bullet text as its own literal constant
(`EARNINGS_PEER_PRINT_IMMINENT_BULLET`, mirroring the existing
`EARNINGS_PEER_SIZING_INSTRUCTION` pattern), and extended `meridianPeerSection()`'s existing
`noGapExposure` swap to also strip that bullet (plus its leading `" · "` separator — safe because
the unconditional "reports in Nd"/"reports today" part is always pushed immediately before it, so
it is never the first joined part) before applying the trailing-sentence swap.

### Evidence

- RED→GREEN: added a regression test reproducing the exact MSFT shape
  (`days_until: 3`-range earnings, contract already expired) — confirmed it fails pre-fix with
  the exact live contradiction text, passes post-fix.
- Added a no-regression sibling test: an imminent (`<=3d`) print the position IS still exposed to
  must keep the "print imminent" bullet (the fix must not silently suppress a real warning).
- Full suite: 16960 pass / 0 fail / 3 skipped (pre-existing skips, unrelated). `tsc --noEmit` clean.

### Blast radius

Single call site (`meridianPeerSection()`) — the pure helper
(`meridianPeerEarningsCoaching()`) is also used nowhere else in the repo (`grep -rn
"meridianPeerEarningsCoaching"` returns only its definition and this one call site).
