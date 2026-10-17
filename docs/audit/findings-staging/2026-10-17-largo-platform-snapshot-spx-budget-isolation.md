> **kind:** FINDING

## Largo `get_platform_snapshot` live-truncated — `fitSpxStructureForModel` fit in isolation, blind to sibling fields — FIXED

| **Status** | Fixed (`src/lib/largo/platform-snapshot-fit.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive. A live CloudWatch sweep of
`/ecs/blackout-production` (correctly re-dated 10:45-11:40 UTC 2026-10-17, not ET as the earlier
agent report mis-labeled it — verified against the raw log timestamps) found 10 `TRUNCATED` tool
results this session's own calls didn't cause, including:
```
get_platform_snapshot TRUNCATED 131690/16000
```

**Root cause.** `fitPlatformSnapshotForModel` (`platform-snapshot-fit.ts`) already fits `raw.spx`
through `fitSpxStructureForModel` — the same fitter `get_spx_structure` uses — but called it with
**no budget override**, so it defaulted to the full `LARGO_RESULT_CHAR_BUDGET` (14000 chars) in
total isolation. `fitSpxStructureForModel`'s own "HARD BOUND" backstop deliberately *maximizes*
usage up to whatever budget it's given (it only shrinks further once already over budget), so a
rich live SPX desk legitimately lands `fitted.spx` close to 14000 bytes on its own. `nighthawk` and
the (already row-capped) `flows` array are then added **on top of** that already-near-full budget,
so the combined envelope can exceed the 16k transport cap whenever `spx` alone is non-trivial —
exactly the measured 131690/16000.

This is the same bug *shape* as two other fixes shipped this session: `get_earnings`
(`unusual_whales`/`estimates` merged with zero budget fitting, #6130) and `get_options_flow`
(`flow_alerts`/`flow_recent` fit in isolation, already fixed separately on `main` via #6111, merged
before this session started working this finding — confirmed by timestamp: the 4
`get_options_flow` truncations in the same sweep all predate #6111's 12:30 UTC merge, so those are
stale pre-fix evidence, not a currently-live bug). A sub-object fit against its own standalone
budget, merged with sibling fields with no shared accounting, blows the outer cap regardless of how
correct the sub-object's own fitter is.

**Evidence the fix targets the right field.** Live-measured `/api/market/spx/desk` (same
underlying `SpxDeskSummary` shape) on a quiet weekend: whole payload 22057 bytes, every individual
field (`dark_pool` 119B, `greek_exposure` 0B market-closed, `levels` 665B, `gex_walls` 802B,
`spx_flows` 7507B, `unified_tape` 4562B, etc.) modest on its own — ruling out "one hidden huge
field" as the cause and confirming the budget-isolation mechanism (which scales with live RTH
desk richness, not a fixed leak) is the real explanation.

**Fix.** Reordered `fitPlatformSnapshotForModel` to decide `nighthawk`/`largo`/`flows` first (small,
or already row-capped), then fit `spx` **last** against whatever budget remains:
`LARGO_RESULT_CHAR_BUDGET - JSON.stringify(fitted-so-far).length`. The combined envelope can now
never exceed budget regardless of how rich the live SPX desk is.

**Why the existing test didn't catch this.** `platform-snapshot-fit.test.ts` already had a test for
"`raw.spx` oversized" (from the earlier #3156-era fix), but its fixture used `flows: []` (empty)
and 2-byte `nighthawk`/`largo` stubs — so `spx` had the *entire* 16384-byte transport cap to itself
and the combined total always passed regardless of whether the budget-isolation bug existed. New
test added with a *realistic* `flows` array (50 rows, sliced to 20) and a realistic `nighthawk`
digest shape alongside the oversized `spx` fixture — confirmed RED against unmodified source
(22791/16384 chars) via `git stash`, GREEN after the fix.

**Tests.** `src/lib/largo/platform-snapshot-fit.test.ts` — new test: "a near-budget spx combined
with realistic flows+nighthawk still stays under the transport cap". Full `src/lib/largo` +
`src/features/spx` suites: 2242/2242 pass.
