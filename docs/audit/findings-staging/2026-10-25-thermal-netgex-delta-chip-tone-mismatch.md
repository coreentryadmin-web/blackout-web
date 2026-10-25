## 2026-10-25 — [FINDING, P2 Thermal] GEX heatmap's Net GEX delta chip colors by the metric's absolute-level tone, not the delta's own direction — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Thermal GEX heatmap intelligence strip (`src/features/thermal/lib/thermal-regime-strip.ts`, `src/features/thermal/components/ThermalRegimeStrip.tsx`) |
| **Found by** | DISCOVERY-lane standing audit mandate, fresh-angle sweep on 2026-10-25 |

### Symptom

The Net GEX chip in the GEX-lens intelligence strip shows a "vs prior close" delta arrow next to
the current value (e.g. `+$12.3B ↓$17.7B`). The delta arrow's color is supposed to signal whether
the metric moved up (green) or down (red) since prior close. Instead it was colored by the
metric's own absolute-level sign: a net-positive (long-gamma) reading that fell sharply vs prior
close rendered its down-arrow in **green**, implying improvement on an actual decrease; the
symmetric case (net-negative GEX that rose) would render an up-arrow in **red**.

### Root cause

`buildThermalRegimeStrip` (`thermal-regime-strip.ts`) received both the absolute level (`netTotal`)
and the delta's own direction (`netDeltaTone`, computed upstream in `GexHeatmap.tsx` from
`net_gex_delta`'s sign) as separate inputs. `netDeltaTone` was used only to decide **whether** to
render the delta chip at all (`netDeltaChip` gating, lines ~188-195) — the direction itself was
then discarded. The segment's `tone` field (consumed by `ThermalRegimeStrip.tsx` to color both the
value AND the delta chip) was set purely from `netTotal >= 0 ? "bull" : "bear"`, i.e. the absolute
level's sign. `ThermalRegimeStrip.tsx:62` then colored the delta chip off that same `seg.tone`:
`seg.tone === "bear" ? "text-rose-300" : "text-emerald-300"` — level color, not delta color.

No existing test caught this because every fixture in `thermal-regime-strip.test.ts` used a
`netDelta`/`netDeltaTone` whose sign happened to match `netTotal`'s sign, so level-tone and
delta-tone divergence was never exercised.

### Fix

Added a `deltaTone?: "bull" | "bear" | "neutral" | null` field to `RegimeStripSegment`, threaded
`netDeltaTone` through into it at all four net-metric segment sites (`netGex`, `netVex`, `netDex`,
`netCharm` — only `netGex` is wired with a live delta today, but the other three share the same
chip-rendering path, so the fix is applied uniformly rather than special-cased to avoid the same
bug reappearing silently once those lenses' deltas are wired up). `ThermalRegimeStrip.tsx`'s delta
chip now colors off `(seg.deltaTone ?? seg.tone)` instead of `seg.tone` alone — falling back to the
level tone only when no delta-specific tone was supplied, preserving existing behavior for every
segment that has no delta chip at all.

### Blast radius

One shared rendering path (`RegimeSegment` in `ThermalRegimeStrip.tsx`) serves all four lens strips
(GEX/VEX/DEX/CHARM); fixed once at the type + render layer rather than per-lens. Only GEX currently
has a populated `netDeltaTone` (`GexHeatmap.tsx`'s `gexTileDeltas.netGex`), so this was the only
lens where the bug could manifest today, but VEX/DEX/CHARM segments now carry the same correct
`deltaTone` field defensively.

### Evidence

- RED→GREEN: new test "net-positive GEX with a down delta carries a bear deltaTone independent of
  the bull level tone" in `thermal-regime-strip.test.ts` — asserts `netGex.tone === "bull"` AND
  `netGex.deltaTone === "bear"` for `netTotal: 12_300_000_000, netDelta: "-$17.7B", netDeltaTone:
  "bear"`. Verified RED against pre-fix source (reverted the two source files only, kept the test):
  `1 subtest failed` (8 pass / 1 fail). Re-applied the fix: `9/9 pass`.
- `npx tsx --experimental-test-module-mocks --test src/features/thermal/lib/thermal-regime-strip.test.ts src/features/thermal/components/*.test.ts* src/features/thermal/lib/*.test.ts` → 88/88 pass (full Thermal lib + component suite, no regressions).
- `npx tsc --noEmit` → clean (after adding `deltaTone` to the `segment()` helper's `Pick<...>` opts type).
