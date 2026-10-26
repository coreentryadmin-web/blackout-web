> **kind:** `FINDING`

## Vector chart fib-retracement drawings had a time-UNBOUNDED hit test — clicking anywhere along a fib price level, even far outside the drawn segment, could select/delete the wrong drawing — FIXED

| | |
|---|---|
| **Severity** | P3 (member-visible UI defect — wrong select/delete target on the Vector chart's drawing layer; no data integrity or financial-correctness impact) |
| **Surface** | `src/features/vector/lib/vector-drawings.ts` — `hitTestDrawing`'s `"fib"` case, used by `useVectorChartDrawings`'s select-tool click handler (`handleChartClick` → `hitTestDrawing`) and keyboard Delete/Backspace on the Vector desk's chart drawing toolbar |
| **Status** | FIXED |

### Root cause

`hitTestDrawing` scores how close a chart click is to each persisted drawing so the `"select"`
tool (and keyboard Delete) picks the right one. Every other multi-point drawing kind bounds its
score by how far the click is from the drawing's actual geometry in BOTH time and price:
`"trend"`/`"ray"` use `dist2ToSegment` (which clamps the projection to the segment, so distance
grows the farther past either endpoint you click), `"rect"` explicitly tests time+price bounds,
`"text"`/`"vline"` score on `(t - d.t)` and `(p - d.price)` together. `"hline"` is the one
legitimate exception — it scores on price alone, because an hline is rendered as a horizontal
price line spanning the *entire* chart width (`applyUserHLines`), so "no time bound" correctly
matches what's drawn.

`"fib"` was scored exactly like `"hline"` — price only, zero consideration of `t` — but a fib is
**not** rendered like an hline. `vector-drawings-primitive.ts`'s `project()` draws each fib
retracement level as a horizontal line segment bounded to `[tLo, tHi]` (`Math.min/max(d.t1, d.t2)`
→ `ts.timeToCoordinate(tLo)`/`timeToCoordinate(tHi)`), i.e. only across the time range the member
actually dragged the tool over. The hit test's extent therefore did not match the rendered extent:
a click at *any* time coordinate on the chart, as long as the price matched one of the fib's
0/23.6/38.2/50/61.8/78.6/100% levels, scored as a hit (`((p - price) / tolPrice) ** 2`, which is
`0` regardless of `t`).

Concretely: draw a fib between 9:30am and 9:35am at prices 100→200. At 3:00pm, clicking anywhere
near price 100 (the 0% level) — nowhere near the visually-drawn segment, which only spans those
five minutes — still registers a hit on that fib in `hitTestDrawing`. In `"select"` mode this
silently selects a drawing nowhere near the actual click; combined with keyboard Delete, a member
trying to delete something else near that price (or trying to draw a NEW fib at that price level)
could instead select and delete the old, unrelated fib with no visual cue why.

### Evidence

New test in `src/features/vector/lib/vector-drawings.test.ts`:
```ts
test("hitTestDrawing: fib hit test is bounded by the drawn [t1,t2] range, not infinite", () => {
  const fib = { id: "fib-1", kind: "fib", color: "cyan", createdAt: 1, t1: 1000, p1: 100, t2: 1100, p2: 200 };
  assert.equal(hitTestDrawing([fib], 1050, 100, 60, 2), "fib-1"); // inside the drawn range — real hit
  assert.equal(hitTestDrawing([fib], 5000, 100, 60, 2), null);    // ~65min past t2 — must not hit
});
```
RED→GREEN confirmed via `git stash` on `src/features/vector/lib/vector-drawings.ts` alone (test
file untouched):
- **Before the fix:** both assertions pass individually but the second one (`t=5000`, 3900s past
  the fib's own `t2=1100`) returns `"fib-1"` instead of `null` — the old code ignores `t` entirely
  for the `"fib"` case, so it fails the "must not hit" assertion.
- **After the fix:** both assertions pass — in-range click still hits, far-outside click does not.

### Blast radius

Only the `"fib"` case of `hitTestDrawing` changed. `"hline"`/`"trend"`/`"ray"`/`"rect"`/`"text"`/
`"vline"` cases are untouched (verified by re-running the full existing
`vector-drawings.test.ts` suite — 9/9 pass, including the pre-existing `hitTestDrawing: finds
nearest hline` case, confirming the hline path's intentional time-independence is unaffected).
`hitTestDrawing`'s only caller is `useVectorChartDrawings`'s select-tool click handler
(`src/features/vector/lib/use-vector-chart-drawings.ts`); no other file calls it. Rendering
(`vector-drawings-primitive.ts`) and persistence (`vector-drawings-store.ts`) are untouched —
this is purely a hit-test-vs-render-extent mismatch fix, not a data-shape change.

### Fix rationale

Added a time-out-of-range penalty (`tOut`, `0` when the click's `t` is inside `[tLo, tHi]`, else
the distance past the nearer boundary) to each fib level's score, combined with the existing
price-distance term the same way `"text"`/`"vline"` already combine time+price:
`(tOut / tolTimeSec) ** 2 + ((p - price) / tolPrice) ** 2`. Inside the drawn range this adds
exactly `0`, so in-range hit sensitivity is byte-identical to before the fix — only the
out-of-range case changes. Considered reusing `dist2ToSegment(t, p, tLo, price, tHi, price) /
tol2` (treating each level as a horizontal segment, matching the `"rect"`/`"trend"` style more
literally) but it changes the in-range price-distance scale (`tol2 = tolTimeSec² + tolPrice²`
instead of the existing `tolPrice²` alone), which would silently loosen in-range fib-selection
sensitivity as a side effect of fixing the out-of-range case — the simpler additive-penalty form
avoids that and keeps the diff minimal and easy to verify.

### Tests

`src/features/vector/lib/vector-drawings.test.ts` (new case added, full file: 9/9 pass).
`npx tsc --noEmit` clean. `npx eslint src/features/vector/lib/vector-drawings.ts
src/features/vector/lib/vector-drawings.test.ts` clean.
