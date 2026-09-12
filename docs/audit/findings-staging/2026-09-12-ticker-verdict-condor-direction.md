> **kind:** FINDING

## Ask Largo `ticker-verdict.ts` fabricated a directional bias from a 0DTE condor's nominal direction — FIXED

| **Status** | Fixed, PR pending |
|---|---|
| **Area** | Ask Largo / BIE deterministic verdict (`src/lib/bie/ticker-verdict.ts`) |
| **Severity** | P2 — deterministic advice-shaped answer could silently fabricate a directional read |

### Root cause

`ecosystem-context.ts`'s `EcosystemZeroDteTake.is_condor` field carries an explicit doc comment:
a committed 0DTE IRON CONDOR's `direction` column is **nominal provenance only** (the fade side of
the pin it came from) — the structure itself is delta-neutral, so treating it as a directional
call fabricates a signal the desk never actually took. The comment names this exact trap and says
consumers comparing `direction` against another desk's directional call "must gate on this before
doing so."

`src/lib/swing/play-brief-intel.ts` (`crossDeskCoaching`/`flowIntelSection`) and
`src/lib/swing/play-brief-narrative-coaching.ts` (`zLong`/`zShort`) already gate correctly —
`z.is_condor === true` renders a distinct "sold iron condor (structure-neutral)" line instead of
comparing direction.

`src/lib/bie/ticker-verdict.ts`'s `structuralBias()` and the ALIGNMENT-line builder in
`synthesizeTickerVerdict()` did **not** gate on `is_condor` at all:

```ts
const z = ctx.zerodte_today;
if (z) {
  if (/long|bull/i.test(z.direction)) score += 1;
  if (/short|bear/i.test(z.direction)) score -= 1;
}
```

and

```ts
if (ctx.zerodte_today) {
  const z = ctx.zerodte_today;
  align.push(`0DTE ${z.direction.toUpperCase()} score ${fmt(z.score)}`);
}
```

So a same-day committed condor (e.g. `direction: "short"`, the fade side of a call-wall pin, on an
otherwise flat/neutral tape) silently nudged the deterministic `VERDICT  Structure reads ...`
line toward bearish/bullish and printed `ALIGNMENT  0DTE SHORT score 91` — presenting a
delta-neutral credit structure as if it were a directional 0DTE call, to a member asking Largo a
plain "should I buy/sell/hold" question. `ticker-verdict.ts` is the deterministic (no-Claude-cost)
fast path for advice-shaped questions, so this fired on every such question for a ticker carrying
a same-day condor.

### Evidence

Added `src/lib/bie/ticker-verdict.test.ts` — RED before the fix: a `zerodte_today` row with
`direction: "short", is_condor: true` and no other directional inputs produced
`ALIGNMENT  0DTE SHORT score 91` verbatim (asserted absent) instead of the honest
`0DTE condor (structure-neutral)` label. GREEN after the fix (`npx tsx
--experimental-test-module-mocks --test src/lib/bie/ticker-verdict.test.ts`, 6/6 pass).
`npx tsc --noEmit` clean.

### Fix

Gate both the score contribution and the ALIGNMENT line on `z.is_condor !== true` /
`z.is_condor === true` respectively — mirrors the exact pattern already shipped in
`play-brief-intel.ts`/`play-brief-narrative-coaching.ts`, so all three consumers of
`EcosystemZeroDteTake.direction` now honor the field's own documented contract. The ALIGNMENT line
for a condor now reads `0DTE condor (structure-neutral) score N` instead of fabricating a
direction.

### Blast radius

Only these two call sites in `ticker-verdict.ts` read `z.direction` directly; no other function in
that file touches `zerodte_today`. `play-brief-intel.ts`/`play-brief-narrative-coaching.ts` were
already correct and untouched.

### Fix rationale

Matched the established, already-reviewed gating pattern in this codebase rather than inventing a
new one — same field, same documented trap, same fix shape, so a future reader sees one consistent
rule instead of two different treatments of the same honesty contract.
