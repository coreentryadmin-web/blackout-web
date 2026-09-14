> **kind:** FINDING

## Night Hawk Legacy — `GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE` makes the target_unreachable rescue path permanently dead (cross-cutting, held)

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy (live-picks-logic, needs a calibration judgment call, not a mechanical one-line fix) |
| **Area** | Night Hawk Legacy — publish-time gates / best-available promotion (`src/features/nighthawk/lib/publish-gates.ts`) |
| **Severity** | P2 — a documented safety-net ("never publish a zero-play edition") is silently inert for one specific, previously-incident-causing failure mode |

### Root cause

`publish-gates.ts` defines two ATR-multiple constants:

```ts
export const GATE_TARGET_MAX_ATR_MULTIPLE = 2.0;          // G-N2, the primary publish gate
export const GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE = 2.0;  // the rescue-path cap
```

A play is only ever blocked with the `target_unreachable` code when its measured
`|target − fill_edge| / ATR14` exceeds `GATE_TARGET_MAX_ATR_MULTIPLE` (2.0) — see
`evaluateNighthawkPublishGates`:

```ts
const targetOk = targetAtrMultiple <= GATE_TARGET_MAX_ATR_MULTIPLE;
...
if (!targetOk) { blocks.push({ code: "target_unreachable", ... value: targetAtrMultiple }); }
```

`isPromotableBlockedPlay` then re-checks the SAME value against the SAME threshold:

```ts
if (block.code === "target_unreachable") {
  const v = Number(block.value);
  if (Number.isFinite(v) && v > GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE) return false;
}
```

Since every real `target_unreachable` block already carries `v > 2.0` (that is the only way
it got blocked), and the rescue cap is *also* 2.0, this condition (`v > 2.0`) is true for
**every single real blocked play, unconditionally**. `isPromotableBlockedPlay` therefore
never returns `true` for a play whose only soft failure is `target_unreachable` — the
promotion path this file explicitly built for that gate is unreachable dead code in
production, despite `target_unreachable` being deliberately excluded from
`NON_PROMOTABLE_GATE_CODES` for exactly the opposite purpose.

### Why this wasn't caught by the existing tests

`publish-gates.test.ts`'s own promotion tests construct `NighthawkGateBlockedPlay` fixtures
by hand rather than running them through `evaluateNighthawkPublishGates`:

```ts
// line 561
blocks: [{ code: "target_unreachable" as const, reason: "too far", threshold: 2.0, value: 1.8 }],
```

`value: 1.8` is **below** `GATE_TARGET_MAX_ATR_MULTIPLE` (2.0) — a multiple that could never
actually appear on a `target_unreachable` block in production, since anything ≤ 2.0 passes
the gate and is never blocked in the first place. The test correctly demonstrates
"promotable when the multiple is ≤ the rescue cap," but the fixture value it uses to prove
that is unreachable outside the test file, so the suite never exercises the real
end-to-end path (evaluate → block → attempt promotion) that shows the rescue is dead.

### Evidence — how the constants actually diverged

`git log -S"GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE = 2.0"` finds the single commit that
introduced both changes together (`02720a972`, "Legacy deep audit: align engine selection
with measured track record", 2026-09-01):

```diff
-export const GATE_TARGET_MAX_ATR_MULTIPLE = 3.5;
+export const GATE_TARGET_MAX_ATR_MULTIPLE = 2.0;
+
+/** Gate-promote rescue may not admit a play whose ONLY soft failure is a target beyond
+ *  this multiple — measured touch rate is already sub-1% at 2.0×. */
+export const GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE = 2.0;
```

The commit's own code comment on `GATE_TARGET_MAX_ATR_MULTIPLE` says: *"Gate-promote rescue
caps even lower (GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE) so thin editions cannot resurrect
unreachable targets."* — describing an *even lower* cap relative to the value being replaced
(the **old** 3.5), i.e. the intent was a rescue window strictly between the new tightened
gate (2.0) and the old looser one (3.5) — not "below 2.0" and not "equal to 2.0" (either of
which makes the rescue permanently unreachable, since anything blocked already exceeds 2.0
by construction). Before this commit, `isPromotableBlockedPlay` had **no** ATR check at
all — any `target_unreachable` block was promotable regardless of how far over the (then
3.5×) gate it was, and the file's own pre-commit comment noted "even a 4× target publishes
with a warning rather than killing the entire edition" (the exact behavior this file's
current design section, lines 96-104, still says is wanted: *"blocking rescue on this gate
is what caused the Jul 27 zero-play edition (all 5 plays blocked, zero promotable,
recap-only published)."*).

### Blast radius

- `promoteTopBlocked` (the only caller of `isPromotableBlockedPlay` in the promotion path)
  silently drops every `target_unreachable`-only blocked play from its `promotable` filter,
  in production, every time it runs.
- `docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md` §N-3/§PR-N13's stated design goal — "the
  pipeline MUST always surface picks for tomorrow" specifically for the `target_unreachable`
  class — does not hold: on a thin session where the ONLY blocked candidates fail
  `target_unreachable` (and nothing else), `promoteTopBlocked` returns `[]`, and the edition
  can publish empty exactly the way the Jul 27 incident did, for the one gate class this file
  was specifically extended to rescue.
- No other call site reads `GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE`, so the blast radius is
  confined to this one function.

### Why this is reported rather than fixed directly

The mechanical bug (the two constants must not be equal — the rescue cap must sit strictly
above the primary gate for any rescue to ever be reachable) is unambiguous. The *exact*
numeric value is not: it is a live-picks calibration choice (how far beyond the primary 2.0×
gate a target may sit before a rescue is "filler, not best-available"), the same class of
decision `GATE_TARGET_MAX_ATR_MULTIPLE` itself documents as measured from real touch-rate
data (`target-reachability.ts`). The most defensible candidate — reusing this file's own
already-shipped, already-measured prior primary-gate value of `3.5` (documented above as
"~0.1% touch odds... the dominant debrief failure mode," i.e. non-zero but low, which is
exactly the character of a last-resort rescue-with-warning candidate) — is a reasonable
starting point, but changing what publishes on a thin session is squarely live-picks logic
per this lane's standing escalation policy, so it is raised here rather than shipped as a
same-cycle fix.

### Suggested fix (for review, not applied here)

```ts
export const GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE = 3.5; // was 2.0 — see finding for why equal-to-the-primary-gate makes this dead
```

Add a regression test that runs a play through the real `evaluateNighthawkPublishGates` →
`isPromotableBlockedPlay` path (not a hand-built fixture) with a target multiple between
2.0× and the new rescue cap, asserting it IS promotable, and one above the rescue cap
asserting it is NOT — closing the exact gap the existing hand-built-fixture tests left open.
