> **kind:** FINDING

## `correctPublicRead` never corrects a wrong-side wall when only ONE wall is in the clause — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven via `git stash` on the source file alone).

### Root cause

`correctPublicRead` (`src/lib/public-gex-snapshot-types.ts`) exists to rewrite the public GEX
snapshot's regime-narration clause ("Resistance X, support Y.") so it never asserts a gamma wall
as support/resistance when the wall actually sits on the wrong side of spot (the exact defect
that shipped live 2026-08-12: SPX spot 7748.5, put wall 8000 — above spot — labeled "support").

The producer of that clause, `gex-cross-validation-core.ts`, builds the tail from two
**independently optional** halves:

```ts
const resistance = callWall != null ? ` Resistance ${fmt(callWall)}` : "";
const support = putWall != null ? `${resistance ? "," : ""} support ${fmt(putWall)}` : "";
const tail = resistance || support ? `.${resistance}${support}.` : ".";
```

So the emitted clause can be any of three shapes depending on which walls exist for that session's
book: `"Resistance X, support Y."` (both), `"Resistance X."` (call wall only), or `"support Y."`
(put wall only, lowercase, no sibling word).

`correctPublicRead`'s detection regex only matched the **first** shape:

```ts
const clause = /\s*Resistance\s+[\d,.]+\s*,\s*support\s+[\d,.]+\s*\./i;
```

When only one wall was present in the clause — a one-sided book, e.g. no put strikes resolved in
range — `clause.test(read)` returned `false` and the function returned the read **completely
unchanged**, even when that lone wall's `classifyWall()` result was `"concentration"` (wrong
side). The exact claim this function exists to prevent shipped straight through whenever the
clause happened to be single-wall.

### Evidence

Confirmed live via a scratch script importing the real functions directly:

```
call role: concentration
input : Spot 7,748.5 is below the gamma flip (7,800) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,490.
output: Spot 7,748.5 is below the gamma flip (7,800) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,490.
unchanged? true
```

`call_wall=7490` sits **below** `spot=7748.5`, so `classifyWall("call", 7490, 7748.5)` correctly
returns `"concentration"` — yet the read still asserted "Resistance 7,490." verbatim, the false
claim the function was written to strip.

Regression test added to `src/lib/public-gex-snapshot.test.ts`
(`"correctPublicRead: a wrong-side wall asserted ALONE (no sibling wall in the clause) is still
corrected"` + a support-only sibling + a correctly-sided-alone control). RED→GREEN proven with
`git stash` on `src/lib/public-gex-snapshot-types.ts` alone (test file kept): 2/34 tests failed
before the fix, 34/34 passed after, with no other test file touched.

### Blast radius

Only one call site: `src/lib/public-gex-snapshot.ts` calls `correctPublicRead` when composing the
`/api/public/gex-snapshot` payload consumed by `GammaSnapshotWidget` (the public, unauthenticated
lead-magnet widget — no member gate, so a wrong claim here is public-facing). `classifyWall` and
`applyPublicReadFreshnessGate` are unaffected; this fix touches only `correctPublicRead`'s
clause-matching and replacement logic.

### Fix rationale

Widened the detection regex so each half is independently optional
(`/\s*(?:Resistance\s+[\d,.]+\s*(?:,\s*support\s+[\d,.]+\s*)?|support\s+[\d,.]+\s*)\./i`), mirroring
the producer's own independent null checks rather than assuming the clause is always two-sided.

The existing replacement logic (`classifyWall` on each side, push the correctly-sided half into
`parts`) already generalized correctly to the single-wall case with no change needed — but the
"both walls sit on the wrong side" fallback message would have been false when only one wall was
ever in the clause (it would claim a second, non-existent wall). Added a second fallback
(`"This gamma wall currently sits on the far side of spot, so it isn't acting as a level."`) gated
on whether both `call_wall` and `put_wall` were actually present, so the message never over-claims
what was in the original text.

Deliberately left unchanged: the two-wall path's exact wording and the "both wrong-side" message
for the genuine two-wall case — both already correct and covered by existing tests.
