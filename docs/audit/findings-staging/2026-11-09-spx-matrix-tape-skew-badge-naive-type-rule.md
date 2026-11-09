# 2026-11-09: SPX Slayer matrix "CALL/PUT skew" badge still used the naive option-type-only rule the real confluence factor already replaced — FIXED

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`computeTapeSkew` (`src/features/spx/lib/spx-tape-display.ts`), which drives the member-facing
"CALL skew / PUT skew / Tape balanced" badge on `SpxMatrixTapeStrip.tsx` (the SPX Slayer matrix
desk), bucketed the top-8 flow prints by raw option **TYPE** alone — every call print's premium
counted toward `bull`, every put's toward `bear` — never asking whether the print was **bought or
sold**.

This is the exact defect `spx-tape-direction.ts`'s own header documents fixing for the desk's real
confluence tape factor: a block of aggressively-**SOLD** calls is bearish conviction, not bullish,
and the reverse for sold puts. That file measured (168h of the real SPX UW tape, 993 8-print
windows — the identical slice this badge scores) that the naive type-only rule **sign-flips the
verdict in 16.8% of windows** versus the aggressor-aware rule. `spx-signals.ts` (the real
confluence factor) and `spx-lotto-catalyst.ts` both migrated to the aggressor-aware
`spxTapeSkew`/`spxFlowSkew` when that defect was found and fixed. `spx-tape-display.ts`'s own
top-of-file comment — `"Mirror of tapeSkew() in spx-signals"` — is now stale: there is no
`tapeSkew()` in `spx-signals.ts` any more (`grep` confirms it), only the aggressor-aware
`spxTapeSkew`/`spxTapeVerdict` this module never adopted. This badge was the one call site left
behind on the old rule: a member could watch the matrix badge say "CALL skew" (green/bullish)
while the desk's own confluence tape factor, scoring the identical 8 prints, called the tape
bearish.

The data needed for the fix was already threaded onto the exact type this function consumes:
`SpxTapeItem.ask_pct` (`spx-desk.ts`) is explicitly documented as "Aggressor share carried through
from the flow brief" — it was simply never read here.

## Root cause

```ts
// before
for (const t of (tape ?? []).filter((x) => x.kind === "flow").slice(0, 8)) {
  if (t.side === "call") bull += t.premium ?? 0;
  else if (t.side === "put") bear += t.premium ?? 0;
}
```

No read of `t.ask_pct` anywhere — option `side` alone decided bullish/bearish, in direct
contradiction of the four-way bought/sold × call/put table (`flowDirection`,
`helix-flow-aggression.ts`) every other direction-reading surface in this product already uses.

## Evidence (RED → GREEN)

New regression test in `spx-tape-display.test.ts` reproduces the exact sign-flip shape: two SOLD
calls (`ask_pct` 20 and 15 — both `<= ASK_SIDE_SOLD_PCT`), $150K premium each, $300K total.

- **RED** (`git stash` isolating only the source fix, test kept): `bull` read `300000` (should be
  `0` — sold calls are bearish, not bullish) and the assertion failed with
  `300000 !== 0`; the overall badge verdict would have been `"call"` on a tape that is actually
  bearish.
- **GREEN** (fix restored): `bull === 0`, `bear === 300000`, `skew === "put"` — matching what
  `spx-signals.ts`'s real confluence factor would call the same 8 prints.

`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-tape-display.test.ts` —
4/4 pass. Sibling suites (`spx-tape-direction.test.ts`, `spx-signals.test.ts`, 30 tests) unaffected
— 30/30 pass. `npx tsc --noEmit` clean.

## Blast radius

Single call site: `SpxMatrixTapeStrip.tsx` is the only consumer of `computeTapeSkew`
(`grep -rl computeTapeSkew src` confirms). No other surface reimplements the old naive rule under
a different name in this sweep — `spx-signals.ts` and `spx-lotto-catalyst.ts` were already on the
aggressor-aware path before this fix.

## Fix rationale

Reuse `spxTapeSkew` (imported from `spx-tape-direction.ts`) rather than re-deriving the four-way
table a second time — the whole point of that module existing is that two lanes reading the same
prints must not be able to drift into disagreeing about what "bullish" means again. `bull`/`bear`
from `spxTapeSkew` are the exact two directional buckets this function already returned; premium
whose aggressor can't be read (missing/midpoint `ask_pct`) drops out of both rather than being
guessed, the same honest-absence convention every sibling consumer of this table follows. The
8-print window and the `TAPE_SKEW_MIN_TOTAL`/`1.25` lead-ratio thresholds are left exactly as
shipped — they are this badge's own choice, not the part that was wrong.

## Next-session market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md`: once RTH opens, cross-check the SPX Slayer
matrix's "CALL skew / PUT skew / Tape balanced" badge against the desk's own confluence panel's
tape factor read on the same live prints — they should never visibly disagree on direction again.
