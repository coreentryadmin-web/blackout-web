> **kind:** FINDING

## Ask Largo swing play-brief: "nearest gamma-flip crossing" distance is sign-inverted relative to every other level in the same brief — FIXED

| **Status** | Fixed (`dealerPostureLine()`'s `nearestCrossingBit`/`fragileBit`, `src/lib/swing/play-brief-narrative.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo × Night Hawk Swings deep-dive (5-engine monitor cycle, 2026-10-17 ~20:40 UTC, checking fresh tickers).

**Live repro.** `GET /api/market/swing/play-brief?playId=SWING:RDDT:1829&ticker=RDDT&positionId=1829&expandIntel=1` — spot 155.20, `gex.flip_nearest` 229.60 (above spot by `(229.60-155.20)/155.20 = +47.9%`). Rendered: *"chain's only crossing sits at **229.60** (**-47.9%** away)"* — wrong sign. The same brief's own "Gamma magnet 177.01 (**+14.1%** from spot)" and "Call wall 220.00 (**+41.8%**)" use the correct, opposite-signed convention for levels above spot. Second repro: `SWING:SOFI:1817` — spot 14.44, `flip_nearest` 1.00 (below spot by -93.1%), rendered "(+93.1% away)" — also backwards.

**Root cause.** Two independent, inconsistent sign conventions for "distance of a level from spot" existed in the swing play-brief pipeline:
- `gex.distance_to_nearest_flip_pct` (`src/lib/providers/gex-positioning.ts`, ~line 389) is computed as `(spot - flip_nearest) / spot * 100` — **positive when the level is BELOW spot** (a "spot relative to level" framing, consistent with that file's own internal `gexContextLine` consumer).
- `play-brief-narrative.ts`'s own `distPct(spot, level)` helper (line 58) computes `(level - spot) / spot * 100` — **positive when the level is ABOVE spot** — and is what every *other* level in the same brief (gamma magnet, call/put wall, confluence) is rendered through.

`dealerPostureLine()`'s two "nearest crossing" clauses (`nearestCrossingBit`, fired when gamma posture is unresolved; `fragileBit`, fired when `flip_crossings > 1`) rendered the raw `gex.distance_to_nearest_flip_pct` field directly instead of recomputing via the file's own `distPct`, so this one field's sign was backwards relative to every sibling "X% away"/"X% from spot" line in the identical document.

**Already baked into the committed test suite as "expected."** Both `play-brief-narrative.test.ts` fixtures passed the raw, sign-inverted field straight through and asserted the (wrong) sign in the expected string: the fragile-flip test (flip_nearest 101.5, spot 100 — true distance +1.5% — asserted "-1.5%") and the GOOG unresolved-posture test (flip_nearest 388.43, spot 344.87 — true distance +12.6% — asserted "-12.6%"). The bug has been live since the feature first shipped (~2026-10-15/PR #6062) and a green regression suite protected the wrong value because the tests were written against the already-buggy output rather than independently checked against spot/level. It went unnoticed because prior audit passes checked whether the crossing was *surfaced at all* (Largo C3, absence), never whether its *sign* was consistent with the rest of the document (Largo C9, precision/consistency).

**Fix.** Both call sites now compute `distPct(spot, gex.flip_nearest)` instead of reading `gex.distance_to_nearest_flip_pct` directly — mathematically the exact negation of the raw field, so this is a pure sign fix, not a value fix. Reusing the file's own existing helper (rather than just negating the raw field inline) keeps both call sites on the one convention the rest of the file already uses, and is self-documenting at the call site.

**Blast radius.** Checked `src/lib/largo/largo-live-feed.ts` (lines 544/558), the only other reader of these raw fields outside `gex-positioning.ts` itself — it renders a neutral "Distance to flip: X%" with no explicit above/below directional framing, so it isn't making the same above/below claim this bug made; not changed.

**Tests.** Updated the two existing tests' expected sign (both were asserting the pre-fix, inverted value) with comments explaining why. RED→GREEN proven via `git stash` of `play-brief-narrative.ts` alone (2 failures without the fix — the two updated tests — 0 with it restored). Full `src/lib/swing` suite: 1820/1820 pass. `tsc --noEmit`: clean.
