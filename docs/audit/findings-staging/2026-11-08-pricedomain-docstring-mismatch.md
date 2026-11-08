> **kind:** FINDING

## `priceDomain`'s docstring claimed it returns `null` for a single-value input — it never has — FIXED

| **Status** | FIXED |
|---|---|
| **File** | `src/lib/meridian/meridian-viz-core.ts` |
| **Function** | `priceDomain(values, padPct)` |
| **Type** | Doc/comment-vs-code mismatch (no behavior change) |

### Root cause

`priceDomain`'s docstring said:

> "Returns null when fewer than two distinct finite values exist: a rail needs an extent, and a
> fabricated one (value ± 1%) would invent a scale the data never supported."

That is not what the function does, and apparently never has been (no git history shows the
`min === max` branch being added after this comment — the comment was simply wrong from the
start, or drifted from an earlier version of the function and was never re-checked against the
code). The actual implementation, immediately below the comment:

```ts
if (min === max) {
  // A single distinct value still deserves a rail — centre it in a small symmetric window
  // derived from its own magnitude, and let callers decide whether one point is worth drawing.
  const eps = Math.abs(min) * 0.01 || 1;
  min -= eps;
  max += eps;
}
```

explicitly does the opposite of what the docstring claims: when only one distinct finite value
survives (every input identical, or every other input was `null`/`undefined`/`NaN` and got
filtered out), it fabricates a small symmetric window around that value and returns a real
`Domain`, never `null`. The in-code comment on the branch itself ("still deserves a rail... let
callers decide") directly contradicts the function-level docstring three lines above it ("a
fabricated one... would invent a scale the data never supported") — the two comments in the same
function disagree with each other, not just with the behavior.

`null` is actually reserved for the stricter case of **zero** finite values (`finite.length ===
0`), which the docstring doesn't mention as the real trigger at all.

### Why this matters (blast radius)

`priceDomain` feeds `pctAlong`, which every Meridian viz rail (`meridian-viz.tsx` — the spot/band
rail at line ~238, the ladder rail at ~349, the move-band rail at ~556, and another rail at
~852) depends on to position markers. A future maintainer reading only the docstring (the stated
contract) rather than the implementation could reasonably:
- "fix" the implementation to actually return `null` on a single distinct value, believing the
  code had a latent bug — which would silently blank every rail for any security currently
  rendering a centred single-point window (e.g. a security where low/high/spot all collapse to
  the same tick, or an expected-move band with zero width), a real UI regression; or
- write new call-site code assuming a single-value input is impossible to render (per the
  docstring) and add defensive branches that duplicate logic the function already handles
  correctly.

Either way, the mismatch is a trap for exactly the kind of refactor this file's own house style
(dense "why" comments) is meant to prevent — the comment itself becomes the thing that's wrong.

### Evidence (RED → GREEN)

1. Added a regression test, `priceDomain: a single distinct finite value still gets a centred
   window, not null`, in `src/lib/meridian/meridian-viz-core.test.ts`, asserting:
   - `priceDomain([100, 100, 100])` is non-null, strictly spans `100`, and centres it (`pctAlong`
     returns `0.5`).
   - `priceDomain([null, 50, undefined])` (one value surviving null-filtering) is non-null.
   - `priceDomain([0, 0])` (the `eps = ... || 1` zero-magnitude fallback) is non-null and spans 0.
2. **RED**: temporarily reverted `priceDomain`'s `min === max` branch to `return null` (i.e. made
   the code match the OLD, wrong docstring) — new test failed (1 fail / 105 pass).
3. **GREEN**: restored the real (and now correctly documented) implementation — full file suite
   106/106 pass.
4. `npx tsc --noEmit` clean.

### Fix rationale

This is a documentation fix, not a behavior change — the shipped behavior (fabricate a small
centred window for a single-value input, honor `null` only for zero finite values) is correct and
is what every call site already relies on. The fix:
- Rewrites the docstring to state the real contract (`null` only for zero finite values; a single
  distinct value gets a synthetic window, with the reason restated so it still carries the "why",
  matching this file's existing comment style).
- Adds the regression test above so a future edit that tries to make the code match the
  previously-wrong docstring is caught immediately, rather than shipping a silent rail regression
  across four Meridian viz call sites.

No alternative considered: the only two ways to resolve a docstring/code mismatch are "change the
code to match the doc" or "change the doc to match the code." The code's behavior is deliberate,
load-bearing (four call sites depend on getting a real `Domain` back for degenerate inputs so
they can render a centred single-point rail instead of silently going blank), and already has its
own "why" comment justifying it — so the doc was the wrong half, not the code.
