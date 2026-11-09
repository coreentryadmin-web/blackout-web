> **kind:** FINDING

## Night Hawk verifier's premium-vs-chain check reported `independentlyConfirmed:true`/`"pass"` even when the comparison never ran — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (correctness-verifier false positive — it is itself an audit tool, so the risk is a silently-trusted "confirmed" that was never checked) |
| **Surface** | `src/lib/correctness/nighthawk-verifier.ts` — `verifyNightHawk()`'s L4 cross-provider chain-confirm layer |
| **Found by** | DISCOVERY round 491, line-by-line read of `nighthawk-verifier.ts` per round 490's flag |

### Root cause

`verifyNightHawk()`'s chain-confirm layer samples a few published plays, parses a strike out of
each play's narrative, and confirms the strike against a live options chain (`confirmed++`). It
*separately* tries to confirm the play's **entry premium** against the chain's bid/ask band — but
only when several gating conditions all hold: `premiumFresh` (edition `published_at` within 4h, a
guard against clock-skew — see the sibling fix this same check already carries), `entry_premium`
present, the contract fully `parsed`, `editionPremiumCheckApplicable(editionFor)`, and a chain
`quote` actually resolved via `chainQuoteForParsedPlay`.

The bug: the code that decided whether to **emit** the "premium" check, and what outcome to give
it, was keyed off `confirmed` (strike-only) and `premiumMismatch`, never off whether the premium
comparison itself had run:

```ts
if (premiumMismatch > 0 || confirmed > 0) {
  checks.push(mk("cross-provider", "premium",
    premiumMismatch === 0 ? "pass" : "flag",
    premiumMismatch === 0
      ? `Sampled play entry premiums sit within the live chain bid/ask band (confirmed against ${confirmed} matched strike(s)).`
      : ...,
    { id: "premium-vs-chain-ask", ..., independentlyConfirmed: premiumMismatch === 0 }));
}
```

Whenever at least one sampled play's **strike** confirmed (`confirmed > 0`) — regardless of
whether the premium comparison was ever attempted — `premiumMismatch` trivially stayed `0` (its
only increment site is nested inside the same gated block that must run before any mismatch could
be recorded), so the check unconditionally read `"pass"` with `independentlyConfirmed:true` and a
detail string claiming "Sampled play entry premiums sit within the live chain bid/ask band...
confirmed against N matched strike(s)" — **when no premium comparison had executed at all.**

This is a direct violation of the verifier family's own documented contract
(`src/lib/correctness/types.ts`'s HONESTY PRINCIPLE): `"pass"` is defined as "every applicable
check held AND a second independent source confirmed it," and `independentlyConfirmed` is
documented as "True when this check was satisfied by an INDEPENDENT second source." Neither held
here — the comparison that would have provided that confirmation never ran.

### Why it wasn't caught earlier

A prior fix (the clock-skew guard, `isZeroDteMarkStale`-based `premiumFresh`) correctly stopped a
stale/future-dated edition from running the premium comparison on garbage data — but its own
regression test (`nighthawk-verifier-premium-future-timestamp.test.ts`) asserted the resulting
metric status as `"pass"`, literally encoding this second bug as the expected behavior. The test's
own prose even named the honest target state ("the honest 'premium check skipped, edition
freshness unproven'") but the assertion itself checked for `"pass"` — a mismatch between the
comment and the assertion that is a textbook instance of exactly what this stayed hidden under.

### Fix

Added a `premiumChecked` counter, incremented only when a chain `quote` was actually resolved and
compared (i.e. the premium comparison genuinely executed), independent of `confirmed`/strike match
and of `premiumMismatch`. The emitted "premium" check now reads:
- `"skipped"`, `independentlyConfirmed:false`, when `premiumChecked === 0` (strike confirmed, but
  premium never compared — freshness gate, missing premium, or no resolvable quote).
- `"pass"`/`"flag"` exactly as before, but only when `premiumChecked > 0` — i.e. when a comparison
  genuinely ran.

### Evidence

Updated `nighthawk-verifier-premium-future-timestamp.test.ts` (the exact fixture that already
exercises the freshness-gated skip path) to assert the `premium-vs-chain-ask` check's `outcome`
is `"skipped"` and `independentlyConfirmed` is `false`, instead of the metric reading `"pass"`.
RED→GREEN confirmed: reverting only the verifier source (keeping the updated test) reproduces the
old bug — `expected: 'skipped', actual: 'pass'` — and restoring the fix passes. Full touched-file
suite (`nighthawk-verifier.test.ts`, `-chain-pulled.test.ts`, `-contradicted-detail.test.ts`,
`-premium-future-timestamp.test.ts`, 11 tests total) passes clean; `npx tsc --noEmit` clean.

### Blast radius

Single call site — `verifyNightHawk()`'s chain-confirm block is the only place this check is
emitted, and `isPremiumChainScaleMismatch`/other helpers in the same file are untouched. No other
verifier file reuses this logic (confirmed via `grep -rn "premium-vs-chain-ask"` — only this file
references that check id).

### What was deliberately left unchanged

The metric-level roll-up for `"premium"` in `score.metrics` still merges this cross-provider check
with the unrelated L2 `premium_cap_ok`/`entry_cost_per_contract` invariant check (both use the
metric name `"premium"`, and `groupMetrics`/`rollUpMetricStatus` merge by metric name across
layers) — so a ticker score can read `"consistency-only"` overall even once this fix lands, when
the cap-invariant check held but the chain-confirm comparison was skipped. That cross-layer
metric-name collision is a separate, more structural question (whether chain-confirm and cap-math
should share a metric name at all) and is out of scope for this fix, which targets the specific
false-confirmation bug in the chain-confirm check itself.
