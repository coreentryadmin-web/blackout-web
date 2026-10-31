> **kind:** FINDING

## Vector wall rail: live king renders with zero crown emphasis on first sight — FIXED

**Status:** Fixed, regression test added (`src/features/vector/lib/vector-wall-rail-king-emph-first-sight.test.ts`).

### Root cause

`WallRailPrimitive` (`src/features/vector/lib/vector-wall-rail-primitive.ts`) draws the
dealer-wall bead rail and animates two eased channels toward per-repaint targets via a
self-stopping rAF loop (`_tick()`, `EASE_K` lerp): bead **half-height** (`_easedHalf`) and
**king emphasis** (`_kingEmph`, the crown rim/glow that marks the dominant strike per side —
documented at the top of the file as a headline feature: "the dominant node stands proud and
its prominence slides vertically to a new strike as the king migrates").

The half-height channel already guards against the obvious trap this animation model
creates — a brand-new key defaulting to the eased map's fallback and animating UP from
there instead of starting correct:

```ts
const cur = this._easedHalf.get(key);
if (cur == null) {
  this._easedHalf.set(key, target);   // first sight -> SNAP to target
  half = target;
} else {
  half = cur;                         // existing key -> ease toward target as usual
}
```

The king-emphasis channel had no equivalent guard. It read:

```ts
const liveEmph = this._reduceMotion ? (isLiveKing ? 1 : 0) : this._kingEmph.get(kKey) ?? 0;
```

`_kingEmph` is populated **only** inside `_tick()`'s own easing loop — never seeded by
`project()` the way `_easedHalf` is. So for any strike's **first-ever** `project()` call
(fresh chart mount, a ticker switch, or any wall newly entering the rendered set — every one
of these resets `_kingEmph` via `detached()`'s `.clear()`, or simply has never had a key for
a brand-new strike), `this._kingEmph.get(kKey)` is `undefined` and `liveEmph` silently
defaults to `0` **even when that strike genuinely is the live king** (`isLiveKing === true`,
`this._kingTargetEmph.set(kKey, 1)` already set on the very same line above). The crown would
then only "ease up" to its correct value of `1` once the rAF loop had actually ticked at
least once.

That is not a one-frame rounding error that resolves itself invisibly: `project()` runs
**synchronously** off `requestUpdate()` inside `setData()` (the chart's pane-view renderer
calls it immediately on the resulting repaint), which happens strictly before any
`requestAnimationFrame`-queued `_tick()` callback can fire. The file's own comment on
`project()` notes it "runs on EVERY canvas repaint (every single wheel/drag tick during a
zoom or pan)" — so a user who switches tickers, or loads the chart fresh, and then
immediately zooms/pans before the very first `_tick()` lands, sees the genuinely-dominant
strike paint with **no** crown boost at all across however many of those repaints occur
first. This is exactly the class of defect the half-height channel's "first sight -> snap"
comment exists to prevent ("a bead never appears at the wrong size; only a CHANGING target
then eases") — the same principle was simply never applied to the second eased channel in
the same function.

### Evidence

Reproduced behaviorally (not just a source scan — `WallRailPrimitive` is a plain class whose
`project()` only touches `window` behind guarded, Node-safe checks, so it can be driven
directly with minimal `chart`/`series` stubs):

1. Constructed a `WallRailPrimitive`, `attached()` it to stub chart/series objects, and
   `setData()`'d a single call trail (strike 100) and a single put trail (strike 110) — each
   side has exactly one trail, so that trail is trivially its own side's live king
   (`kingStrikeByTime` has nothing else to compare it against), isolating the bug from any
   kingship-selection logic.
2. Called `project()` once — mirroring the real first repaint after `setData()`, before any
   `_tick()` has ever run.
3. **Before the fix:** the live bucket's `emph` on both bands read `0` (RED — see the test's
   assertion message; confirmed via `git stash` on the source file alone, re-running the test
   unchanged).
4. **After the fix:** both bands' live-bucket `emph` read `1` (GREEN).
5. `npx tsc --noEmit` clean; `npx eslint` clean on both changed files; the three existing
   `vector-wall-rail*` test files (`vector-wall-rail-core.test.ts`,
   `vector-wall-rail-primitive-no-outline.test.ts`, `vector-wall-rail-rth-gate.test.ts`) plus
   the new regression test all pass together (78/78).

### Blast radius

Only one call site constructs/drives `WallRailPrimitive` for both sides (call and put share
the same `addTrail` closure inside `project()`), so the fix applies uniformly to both the
main desk chart and the Compare-pane rail (same primitive, different `profile`/tuning). No
other file reads `_kingEmph`/`_kingTargetEmph`; this is a self-contained, single-file fix.

### Fix rationale

Mirrored the half-height channel's own already-shipped "first sight -> snap" pattern exactly,
rather than inventing a different mechanism: on `cur == null` (never-before-seen key), set
`liveEmph` directly from `isLiveKing` and seed `_kingEmph` with that value, instead of
defaulting through `?? 0`. A **changing** target for an already-seen strike still eases
through `_tick()` exactly as before — this only removes the cold-start defect where a
brand-new key had no correct value to fall back to. Left `_kingTargetEmph` untouched (it
already always carries the correct target); left the departing-king decay loop in `_tick()`
untouched (it operates on keys that have, by definition, been seen before, so it was never
exposed to this gap).
