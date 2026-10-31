> **kind:** FINDING

## MeridianCountUp: an interrupted count-up animation snaps to a value the viewer never saw — FIXED

**Status: FIXED** (`fix/meridian-countup-interrupt`, round 179 DISCOVERY sweep)

### Root cause

`MeridianCountUp` (`src/features/meridian/components/meridian-viz.tsx`) interpolates its
displayed `shown` number from an old value to a new `value` prop over `durationMs` (default
520ms), via a cubic ease-out driven by `requestAnimationFrame`:

```ts
const tick = (now: number) => {
  const t = clamp((now - start) / durationMs, 0, 1);
  const eased = 1 - (1 - t) ** 3;
  setShown(from + (value - from) * eased);
  if (t < 1) rafRef.current = requestAnimationFrame(tick);
  else fromRef.current = value;
};
rafRef.current = requestAnimationFrame(tick);
return () => {
  if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  fromRef.current = value;              // <-- the bug
};
```

The effect's dependency array is `[value, durationMs]`, so a SECOND prop change inside the same
~520ms window re-runs the effect before the first animation finishes. React runs the in-flight
effect's cleanup first (cancelling the pending `rAF`), then starts the new effect.

The cleanup set `fromRef.current = value` — but `value` here is **this effect's own closed-over
TARGET**, the number the just-cancelled animation was still mid-flight *toward*. The viewer never
actually saw that number rendered; the animation was interrupted before reaching it. The next
animation's very first tick runs at `t = 0`, so `eased = 0` and
`setShown(from + (target - from) * 0)` reduces to `setShown(from)` — i.e. `setShown(value)` using
the stale target as `from`. The display therefore **snaps straight to the unseen stale target for
one rendered frame**, then continues animating on toward the newest value — a visible
flicker/jump on any metric whose updates can arrive faster than it counts up.

This directly contradicts the file's own stated design rule 2 at the top of
`meridian-viz.tsx` ("MOTION ENCODES CHANGE... things move when a value moves"): an interrupted
count-up is supposed to continue smoothly from where the viewer last saw it, not jump backward
(or forward) to a number that was never actually displayed.

### Evidence

Extracted (worktree `git stash` on the source file alone) the pre-fix and post-fix source and ran
the new regression test, `meridian-viz-countup-interrupt.test.ts`, against both:

- **RED (pre-fix source):** both assertions fail — no `shownRef`, and the cleanup matches the
  buggy `fromRef.current = value;` pattern verbatim.
- **GREEN (post-fix source):** both assertions pass.

Full RED/GREEN transcripts captured during the fix; see PR for the exact `npx tsx
--experimental-test-module-mocks --test` output. No render harness exists in this repo for a
hooks/`rAF`-driven component (same constraint already documented by
`src/features/vector/components/VectorScanner.test.ts` and this file's own sibling
`meridian-viz-freshness.test.ts`), so the regression test asserts on the component's source text,
matching that established precedent exactly.

### Blast radius

`MeridianCountUp` has exactly one call site, `MeridianRing` (same file), which is itself rendered
from `MeridianEarningsReportPanel.tsx`'s per-dimension conviction rings (`d.intensity`, 0–100,
polled/refetched as the earnings report refreshes). No other component in the repo imports
`MeridianCountUp` directly. The fix is entirely local to this one hook; no other call site, no
server code, and no other primitive in `meridian-viz.tsx` shares this interpolation logic.

### Fix rationale

Added a second ref, `shownRef`, that mirrors `shown` synchronously — including every mid-flight
partial value set inside the `rAF` loop, not just the start/end of an animation. A `ref` (unlike
`state`) is readable immediately inside the cleanup that runs in the same tick a new `value`
arrives, before React has committed any render for the new props. The cleanup now resumes from
`shownRef.current` (the value actually last rendered) instead of `value` (the effect's own
target), so an interrupted animation continues smoothly rather than snapping.

Deliberately left unchanged: the easing curve, `durationMs` default, the "first paint / arriving
from no-data lands directly on the value" branch, and the natural-completion path
(`else fromRef.current = value;` inside `tick` when `t >= 1`) — that path is correct as-is, since
by construction, at natural completion, `shown` has already reached `value` (and therefore
`shownRef.current === value` too), so no change was needed there.

### Files touched

- `src/features/meridian/components/meridian-viz.tsx` — `MeridianCountUp` fix.
- `src/features/meridian/components/meridian-viz-countup-interrupt.test.ts` — new regression test
  (RED→GREEN proof above).
