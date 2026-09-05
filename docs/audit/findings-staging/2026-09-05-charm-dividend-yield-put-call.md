## Thermal/GEX CHARM: shipped formula used the call-shaped expression for BOTH call and put contracts — wrong whenever the dividend yield is nonzero

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 (a heatmap-metric magnitude/sign defect, not a member-facing outage) |

### What was broken

`charmPerShare` (`src/lib/providers/polygon-options-gex.ts`) computed net dealer dollar-CHARM for
Thermal's GEX heatmap using a single closed-form expression applied identically to call and put
contracts, documented as "type-independent... like gamma". That is only true when the dividend
yield `q = 0`. The formula itself was also missing the dividend-yield-dependent term of the full
Black-Scholes charm derivative (the `q·N(d1)` / `q·e^(−qT)` terms that arise from differentiating
the `e^(−qT)` discount factor in `Delta(T) = e^(−qT)·N(d1(T))`), so even the call side was subtly
wrong whenever `q > 0`.

Real-world impact: this codebase already flags SPY/QQQ/IWM as carrying a material dividend yield
for GEX purposes (`gex-depth-validate.mjs`'s docstring: raw BS-vs-provider gamma gaps of 9.5%
(SPY), 15.8% (QQQ), 21.7% (IWM) — attributed to the dividend yield the `r=q=0` closed form doesn't
model). CHARM uses the exact same `q` input (`dividendYieldQ`), so the same tickers were affected.

### Why CLQ-017 (the question that surfaced this) matters as a process point

CLQ-017 (BLACKOUT Claude↔Cursor cross-exam, 2026-09-05) asked whether CHARM had ever been
validated against a ground truth the way GEX was (`gex-depth-validate.mjs`). Cursor's answer:
**PROVEN gap** — locally-computed BS charm, no validator of any kind. Polygon's option-chain
snapshot greeks do not carry charm, so there is no live provider number to check against (unlike
GEX, where the provider's own gamma is the ground truth `gex-depth-validate.mjs` compares to).
That ruled out a live-validator script as the fix. The cheaper, still-real alternative — an
independent finite-difference check of the closed-form formula against numerical differentiation
of its own Delta(T) — is what this PR adds as a permanent regression test, and running it against
the *existing* formula (before writing any fix) is what surfaced the actual bug: a q=0.015, T=0.18y
test case showed the shipped call formula reading 0.0631 against a finite-difference of 0.0711 (an
~11% understatement), and the put case diverged further since the shipped code used the SAME value
for puts that should differ once q≠0.

### Evidence

`src/lib/providers/polygon-options-gex.test.ts` — two new tests directly reproduce the bug via an
INDEPENDENT (not imported from production) Black-Scholes delta implementation, finite-differenced
w.r.t. time-to-expiry:
- Against the OLD formula (verified by temporarily reverting the `.ts` fix while keeping the new
  tests — RED): call-side test failed (0.0631 vs finite-difference 0.0711), put-side test failed
  the same way. 66/68 pass, 2/68 fail.
- Against the FIXED formula — GREEN, 68/68 pass, including a locked-in q=0 regression value
  (`-0.5147947317153562` for spot=450/strike=455/T=0.08/σ=0.22) proving the fix reproduces the old
  formula's output byte-for-byte at q=0, where the old formula was already correct.

### Root cause

For a call, `Delta(T) = e^(−qT)·N(d1(T))`. Charm is `−dDelta/dT`. Differentiating through BOTH the
`e^(−qT)` discount factor and `d1(T)` gives:
```
charm_call = e^(−qT) · ( q·N(d1) − φ(d1)·d1' ),  d1' = (σ²/2 − q)/(σ√T) − d1/(2T)   [r=0]
```
For a put, `Delta_put(T) = e^(−qT)·(N(d1)−1) = Delta_call(T) − e^(−qT)`, so:
```
charm_put = charm_call − q·e^(−qT)
```
At `q=0` both collapse to the exact same value the shipped formula already computed correctly
(hence the byte-identical regression value above) — the bug only manifests for `q > 0`.

### Fix

`charmPerShare` now takes a `type: "call" | "put" = "call"` parameter and implements the full
dividend-yield-correct formula above (added a local `normCdf`, mirroring `gex-depth.ts`'s existing
duplicated Zelen–Severo approximation rather than importing across modules). The single call site
in `polygon-options-gex.ts`'s heatmap accumulation now passes the contract's own `type` through
instead of relying on a shared "type-independent" value. Both formulas are numerically verified
against independent finite-difference derivatives to ~1e-6 relative across S/K/T/σ/q test points.

### Blast radius

One function, one call site (`charmPerShare` is only invoked in the CHARM accumulation branch of
the heatmap builder — confirmed via grep, no other caller). `vannaPerShare` (VEX) was checked for
the same class of bug: VEX's magnitude is genuinely type-independent even at `q>0` (vanna is
`∂²V/∂S∂σ`, which does not involve the `e^(−qT)` discount factor's time-derivative the way charm's
does), so it was left unchanged — confirmed by the existing `vannaPerShare` docstring's derivation
and by this PR NOT touching it.

### Fix rationale — why not also revisit the "type-independent" comment pattern elsewhere

Gamma genuinely IS type-independent regardless of `q` (gamma is `∂²V/∂S²`, and the dividend
discount factor's effect on gamma is a spot-scaling, not a call/put asymmetry) — that comment
pattern on `gammaPerShare`/the GEX accumulation path is correct as-is and was not touched.
