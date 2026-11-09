> **kind:** FINDING

## Meridian earnings-intel `fmtPrem` (net GEX / net premium) had no billion/trillion tier — FIXED

| | |
|---|---|
| **Area** | Meridian earnings intel (`src/lib/meridian/meridian-earnings-intel.ts`) |
| **Severity** | P3 (display correctness — number is right, label is nonsensical) |
| **Status** | FIXED |

### Root cause

`meridian-earnings-intel.ts` carried its own, hand-maintained copy of the exact K/M/B/T compact-
dollar formatter that already lives (correctly, with all four tiers) in its sibling,
`meridian-earnings-intel-core.ts`'s `fmtPremShort`:

```ts
function fmtPrem(n: number): string {
  if (!Number.isFinite(n)) return "$—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;   // <- no B/T tier past this
  if (abs >= 1_000) { ... K->M round-first-then-promote guard only ... }
  return `$${n.toFixed(0)}`;
}
```

This copy was forked from `fmtPremShort` **before** that sibling's round-419 (B tier) and
round-439 (T tier) fixes landed, and was never updated when they did — its own in-file comment
only cites the round-399 K→M guard, which is the state `fmtPremShort` was in at the moment this
file's copy was made. Every value at or above `$1,000,000` fell into the `M` branch
unconditionally, with nowhere to promote to past that.

`fmtPrem` has exactly two call sites feeding plausibly-billion-scale real values: `net_gex`
(`thermal.net_gex`, a single ticker's dealer gamma exposure) and `net_premium`
(`input.pack.flow.net_premium`, net options premium for that ticker). Dealer gamma exposure for a
heavily-traded mega-cap (NVDA/AAPL/TSLA/SPY) routinely prints in the hundreds of millions to low
billions around earnings — exactly the magnitude `fmtPremShort`'s own test file already
documents for the structurally identical dark-pool-premium case (round 419's comment: "routinely
in the hundreds of millions to low billions for a heavily-traded mega-cap... NVDA/AAPL/TSLA").

### Evidence

```
fmtPrem(1_500_000_000)  // pre-fix
=> "$1500.0M"           // nonsensical 4+ digit label — the value is $1.5B, not $1500M
```

A fresh regression test (`meridian-earnings-intel-core.test.ts`) proves RED→GREEN:

```
# pre-fix (fmtPremShort unexported, no naLabel param, fmtPrem still hand-copied): 4 failed, 34 passed
# post-fix: 38 passed, 0 failed
```

### Blast radius

Only `fmtPrem`'s own two call sites inside `meridian-earnings-intel.ts`:
- `net_gex_label` (dealer gamma exposure, Meridian earnings "Thermal" GEX card)
- `net_premium_label` (HELIX flow net premium, Meridian earnings flow card)
- `premium_label` on individual dark-pool prints and `s.total_premium`/`s.net` (same function,
  smaller individual prints — real-world magnitude lower but the same formula, so covered by the
  same fix)

No other file reimplements this exact ladder a second time once this fix lands — `fmtPremShort`
itself (the correct, four-tier version) is unchanged apart from being exported with a new,
backward-compatible optional `naLabel` parameter (defaults to `"—"`, its existing behavior for
every pre-existing call site inside `shapeMeridianDarkPool`).

### Fix rationale

Rather than re-patching the duplicate ladder a second time (which is exactly how this bug was
created — a correct fix landing in one copy and never propagating to the other), `fmtPrem` now
**delegates** to the already-correct, already-tested `fmtPremShort` (now exported), passing its
own long-established `"$—"` non-finite fallback as the new `naLabel` parameter so neither caller's
existing non-finite rendering changes. One shared implementation can no longer drift out of sync
with itself the way the two independent copies just did.

`meridian-earnings-intel.ts` imports `"server-only"` transitively and cannot be exercised in a
`node:test` run directly (CLAUDE.md lesson #14) — the regression test instead exercises the now-
exported `fmtPremShort` directly with the exact `naLabel` `fmtPrem` passes it, which is what
actually proves the delegate is correct now that it is a one-line wrapper.

### Test

`src/lib/meridian/meridian-earnings-intel-core.test.ts` — four new cases: billion-scale promotion,
trillion-scale promotion, the new `naLabel` default/override behavior, and a sub-threshold
no-cosmetic-drift check. Run: `npx tsx --experimental-test-module-mocks --test
src/lib/meridian/meridian-earnings-intel-core.test.ts`.
