## 2026-10-12 — [FINDING, P4 dead-code] `VectorPulse.tsx` orphaned since 2026-08-14 by the Helix-rail swap — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Vector desk / components | P4 — dead code, no runtime impact | FIXED |

**What's wrong.** `src/features/vector/components/VectorPulse.tsx` (478 lines — a signal-pulse
feed card: dedup + rate-capped detection/play-state/flow signals rendered as a scrolling list) has
had zero reachable render call sites since 2026-08-14. Commit `b2e3062ab` ("feat(vector): replace
Pulse rail with ticker-scoped Helix flows (#2201)") removed its only render site and import from
`VectorPageShell.tsx`, swapping in `VectorHelixRail` instead — the commit message says so
explicitly: "Swap it for a live Helix tape." The component file itself, and its dedicated
regression test, were left behind. Confirmed via exhaustive grep (`components/VectorPulse["']` /
`<VectorPulse[\s/>]`): no file anywhere imports or renders it, and it is not barrel-exported from
`src/features/vector/index.ts`.

**The same "superseded-but-never-cleaned-up" shape found and fixed three times already this
session** — Thermal's `ThermalCompareStrip.tsx` (swapped for `ThermalTripleDesk`), Vector's own
`vector-helix-flows.ts` dead filter fields, and Meridian's `MeridianBeatHistory`'s dead `onSelect`
prop — all components/fields fully superseded by newer behavior but never deleted.

**What was deliberately NOT touched.** `src/features/vector/lib/vector-pulse.ts` (the data/curation
lib `VectorPulse.tsx` imported from — `dedupeByKindLevel`, `applyGlobalRateCap`,
`buildPulseSnapshot`, etc.) is NOT dead: confirmed it's still a real, live import of
`src/features/spx/components/SpxPulseRail.tsx` (and documented in
`docs/audit/SPX-PULSE-RAIL.md`/`scripts/audit/spx-pulse-session-replay.mjs`). Only the Vector-desk
UI shell goes; the shared curation logic stays exactly as-is. Likewise every other import
`VectorPulse.tsx` pulled in (`fetchFlows`, `useSpxPlay`, `renderEmphasis`, various Vector lib
types) is independently live elsewhere — confirmed none become orphaned by this deletion.

**Fix.** Deleted `VectorPulse.tsx`. Removed its one dedicated test in
`src/features/vector/vector-ios-native.test.ts` ("VectorPulse — feed curation (dedup + rate cap)
wired into all three signal sources") — it only read the dead file's own source text and asserted
internal self-consistency, so it could never fail regardless of real behavior; a source-scan test
of a file with zero callers is not a regression guard. A different, pre-existing test in the same
file (`"VectorTechnicalsPanel — honest-absence + reuses VectorPulse's intel-card markup"`) merely
*names* `VectorPulse` in its title as provenance for a shared `vp-` CSS-class-prefix convention — it
reads `VectorTechnicalsPanel.tsx`, not the deleted file, so it's unaffected and left untouched.

**What was checked and found clean (same sweep).** Explicit dead-component grep across every other
file in `src/features/vector/components/` (`VectorRegimeBanner`, `VectorPlayIntelStrip`,
`VectorCrosshairLegend`, `VectorReplayPlayGate`, `VectorTechnicalsPanel`, `VectorDrawToolbar`,
`VectorNodesToggle`, `VectorVolumeModeToggle`, `VectorWallEventTooltip`,
`VectorPaneErrorBoundary`) — all have live callers, no orphaned props. `VectorChartViewSelect.tsx`/
`VectorDailyChart.tsx` are also unreferenced, but that's an intentional, self-documented 2026-08-26
product decision (own comment + `vector-chart-viewport.test.ts:538-556` explicitly says "left in
place (unused)") — not an oversight, so not touched here.

**Verification.** `tsc --noEmit` clean. Full Vector feature suite (`npx tsx
--experimental-test-module-mocks --test $(find src/features/vector -name "*.test.ts" -o -name
"*.test.tsx")`) — 1403/1403 pass (was 1404; one orphaned test removed). `vector-pulse.ts`'s own lib
test + every discoverable SPX pulse test — 90/90 pass, confirming the shared curation logic is
untouched.

**Blast radius.** Two files only: delete `VectorPulse.tsx`, trim one test block from
`vector-ios-native.test.ts`. No change to `VectorPageShell.tsx`, `vector-pulse.ts`, or any SPX file.

Found via a background Explore-agent sweep of Vector's broader UI/component layer, independently
re-verified before fixing: confirmed zero outside callers via grep, the exact commit/diff that
orphaned the file via `git log -S`, that `vector-pulse.ts` and every other import stay genuinely
live elsewhere, and that the sole dedicated test for the dead file asserted nothing but the file's
own source.
