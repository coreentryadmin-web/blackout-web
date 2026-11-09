> **kind:** FINDING

## Vector GEX heatmap `selectHeatmapStrikes` never actually capped the near-spot band — the strike axis could overflow `maxStrikes` by 3-4x on a tight-increment chain — FIXED

| | |
|---|---|
| **Area** | Vector desk — `src/features/vector/lib/vector-gex-reconstruct.ts` (`selectHeatmapStrikes`, feeding `reconstructGexHeatmapGrid`) |
| **Severity** | P3 — correctness/performance (bounded-size invariant silently violated; not a trading-decision bug) |
| **Status** | FIXED |

### Root cause

`selectHeatmapStrikes` builds the strike (y-axis) rows for the Vector GEX strike×time heatmap
grid in two passes: first add every strike inside the near-spot band (`spotBandPct`, default
4%), then fill any remaining room up to `maxStrikes` with the next-heaviest `|GEX|` strikes
outside the band. The function's own doc comment and its caller's doc comment both promise this
stays bounded — `reconstructGexHeatmapGrid`'s header says the strike axis is "capped to the
`maxStrikes` heaviest strikes... so the grid stays bounded on a wide chain."

The first (near-spot-band) loop had **no cap check at all**:

```ts
if (spot != null && spot > 0 && spotBandPct > 0) {
  for (const [strike] of ranked) {
    if (Math.abs(strike - spot) / spot <= spotBandPct) selected.add(strike);
  }
}
```

It added every strike inside the band regardless of how many that was. The second loop (the
off-band fill) does check `selected.size >= maxStrikes` before adding more — but by the time it
runs, the band loop may already have blown past the cap, and the second loop's break condition
can only ever stop it from adding *more* strikes; it has no way to shrink what the first loop
already added. So on a chain where the near-spot band alone contains more candidates than
`maxStrikes`, the returned strike axis silently exceeded the requested cap, every time.

This is not a hypothetical chain shape. The live caller (`vector-gex-heatmap-server.ts`) passes
`maxStrikes: 80` and `spotBandPct: 0.04`. A 4% band around a ~7500 SPX-shaped spot spans ±300
points; SPX weekly strikes run as fine as $2.50-$5 near the money, which puts well over 80
distinct strikes inside that single band before the "then heaviest" fallback logic ever gets a
chance to apply the cap.

### Evidence

Reproduced directly against the pure function (no network/DB needed — this module is
deliberately pure per its own header):

```
peak = 301 strikes spaced $2 apart, spanning spot ± 4% (7200..7800, spot=7500)
selectHeatmapStrikes(peak, 80, 7500, 0.04)
  BEFORE fix: returns all 301 strikes (cap silently ignored)
  AFTER fix:  returns exactly 80 strikes
```

Confirmed RED→GREEN: reverted the one-line fix locally, re-ran the new regression test
(`selectHeatmapStrikes: NEVER exceeds maxStrikes even when the near-spot band alone has more
candidates than the cap`) — failed with `301 !== 80`. Restored the fix — test passes, full
`vector-gex-reconstruct.test.ts` suite green (23/23).

### Blast radius

`selectHeatmapStrikes` is the strike-axis selector for `reconstructGexHeatmapGrid`, which builds
the strike×time GEX positioning surface (`times`/`strikes`/`cells`/`maxAbs`) that
`vector-gex-heatmap-server.ts`'s `getVectorGexHeatmap` caches (Redis, keyed by ticker/horizon/
session/bucket) and serves to the Vector chart's heatmap overlay. No other caller of
`selectHeatmapStrikes` or `reconstructGexHeatmapGrid` exists in the repo (grepped). The effect of
the bug is confined to this one grid: an oversized `strikes`/`cells` axis on any ticker/session
whose near-spot band is strike-dense — bloating the cached payload and the client-side render
(the underlying per-cell numbers were still correct; only the row COUNT exceeded the intended
cap).

### Fix rationale

Add the same `if (selected.size >= maxStrikes) break;` guard to the near-spot band loop that the
off-band fallback loop already has. `ranked` is sorted by `|GEX|` descending before either loop
runs, so capping the band loop still preserves the documented "near-spot band, heaviest-first"
semantics — it now stops adding once the axis is full, prioritizing the heaviest in-band strikes
over lighter ones, exactly the same discipline the second loop already applies for off-band fill.
Deliberately left unchanged: the overall two-pass structure (band-first, then heaviest-elsewhere)
and the default `spotBandPct`/`maxStrikes` values — those are product decisions, not part of this
bug.

### Regression tests added

`src/features/vector/lib/vector-gex-reconstruct.test.ts`:
- `selectHeatmapStrikes: NEVER exceeds maxStrikes even when the near-spot band alone has more
  candidates than the cap (round 479 regression)` — 301 band-only candidates, `maxStrikes=80` →
  must return exactly 80.
- `selectHeatmapStrikes: when the band overflows the cap, keeps the heaviest in-band strikes
  first` — confirms the cap doesn't just truncate arbitrarily; the two heaviest in-band strikes
  survive over 21 lighter in-band candidates.
