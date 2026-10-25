## 2026-10-25 — [FINDING, P2 Night Hawk 0DTE] MOMENTUM origin would be silently dropped on merge + flat/dead data would falsely read as a developing coil — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | `src/lib/zerodte/board.ts` (discovery-origin merge/label), `src/lib/zerodte/early-entry-pressure.ts` (developing-pressure detection) |
| **Found by** | Self-audit while wiring the new MOMENTUM/"early-entry" discovery origin onto the live 0DTE board (operator directive, 2026-10-25) |
| **Status** | FIXED |

### Finding 1 — `unionDiscoveryOrigins`/`discoveryOriginLabel` would have silently dropped `"MOMENTUM"`

`DiscoveryOrigin` (board.ts) gained a 4th member, `"MOMENTUM"`, for the new discovery origin. Both
`unionDiscoveryOrigins` (used at every multi-rail merge) and `discoveryOriginLabel` (the
calibration origin-band label) filter their output through `DISCOVERY_ORIGIN_ORDER`, a hand-
maintained whitelist that — before this fix — still only listed `["FLOW","BREAKOUT","PIN"]`.

**Consequence had this shipped unfixed:** a MOMENTUM-origin setup merged with any FLOW/BREAKOUT/PIN
setup on the same ticker would have had `"MOMENTUM"` silently dropped from the resulting
`discovery_origin` set by `unionDiscoveryOrigins` (it filters `DISCOVERY_ORIGIN_ORDER.filter(o =>
seen.has(o))`, and `"MOMENTUM"` was never in that list). A *pure*-MOMENTUM setup (no other origin)
would have mislabeled as `"no_origin"` in `discoveryOriginLabel` (same filter, same empty result)
— i.e. the calibration origin-band report would have shown every pure-MOMENTUM commit as if it had
no discovery provenance at all, defeating the entire point of the per-origin win-rate tracking this
file's own header describes.

### Finding 2 — perfectly flat/dead bars would read as a genuine pre-breakout coil

`detectDevelopingPressure`'s compression check originally read:
```
const ratio = baselineRangePct > 0 ? recentRangePct / baselineRangePct : null;
const compressed = recentRangePct <= compressionMaxAbsPct && (ratio == null || ratio <= compressionMaxRatio);
```
When the baseline (lookback) window's own range was exactly 0 (no real prior swing ever existed —
e.g. a halted name, a data gap, or simply dead pre-market-adjacent bars), `ratio` is `null`, and the
`ratio == null || ...` fallback evaluated to `true` — so a market with **no real price action at
all** passed the compression check purely because it had nothing to compress FROM. Combined with
every bar in such a flat window trivially "touching" its own flat high/low, this would have
reported `developing: true` (a real coil under a tested level) for data that was simply not moving,
given RVOL also happened to clear its floor.

### Fix

**Finding 1:** `DISCOVERY_ORIGIN_ORDER` extended to `["FLOW","BREAKOUT","PIN","MOMENTUM"]`
(MOMENTUM seated last — lowest tie-break priority, consistent with being the newest, least-proven
origin). `summarizeDiscoveryRailMix` extended to count it too (a separate, lower-severity gap in
the same area — the observability log would have silently never shown MOMENTUM's contribution).

**Finding 2:** compression now requires `baselineRangePct > 0` as a REQUIRED condition, not merely
"if we can't compute a ratio, don't block":
```
const compressed = baselineRangePct > 0 && recentRangePct <= compressionMaxAbsPct && ratio! <= compressionMaxRatio;
```
A zero (or missing) baseline range now correctly reports `compressed: false` — there is no real
swing to have coiled under.

### Evidence / tests

**Finding 1** — `src/lib/zerodte/board.test.ts`: `unionDiscoveryOrigins: MOMENTUM survives a union
with another origin, never silently dropped` and `discoveryOriginLabel: a pure-MOMENTUM origin set
labels as "MOMENTUM", never "no_origin"` (both RED before the `DISCOVERY_ORIGIN_ORDER` fix, GREEN
after). `summarizeDiscoveryRailMix counts a MOMENTUM-origin setup` locks in the mix-counter fix.

**Finding 2** — `src/lib/zerodte/early-entry-pressure.test.ts`: `detectDevelopingPressure:
perfectly FLAT data (zero baseline range) never reads as a coil, even though its own tiny range
clears the absolute ceiling` (RED before the fix — flat bars reported `developing: true` with RVOL
confirmed; GREEN after). Confirmed live during integration testing: `momentum-signal-discovery.test.ts`'s
"flat bars" fixture only correctly produced zero setups/watches once this fix landed — before it,
the same fixture (flat 100±0.5 bars) was tripping the compression check and reaching a live chain
fetch it had no business reaching.

Both fixes are covered by the full suite run reported in the shipping PR (16855 pass / 0 fail / 3
skipped pre-existing, Node 20, `npm test`); `npx tsc --noEmit -p .` clean.
