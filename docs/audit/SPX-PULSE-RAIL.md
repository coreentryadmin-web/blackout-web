# SPX Pulse Rail — event catalog + enhancement spec (2026-07-26)

Replaces the **Largo commentary rail** with an **enhanced ⚡ Pulse event feed** as the DEFAULT
left-column presentation on the SPX Slayer desk (`/dashboard`). Largo is **not removed** — a
per-device toggle (`SpxIntelRail`) flips back to it, and its engine/backend
(`spx-live-voice.ts`) is untouched.

The Pulse **engine** was widened additively in `src/features/vector/lib/vector-pulse.ts`
(shared type + curation primitives) and the SPX-specific detector lives in
`src/features/spx/lib/spx-pulse.ts`. **Vector's Pulse is unaffected** — it emits the same
kinds with none of the new optional fields (proven by `vector-pulse.test.ts`).

## RTH-realness: data source per event

Every event derives from the **real merged SPX desk snapshot** the desk already polls
(`voiceSnapshotFromDesk(desk)` — the exact numbers members see), plus three inputs the voice
snapshot doesn't carry (macro calendar, EOD pin forecast, ET session clock). Where a source is
missing the kind simply does not fire — **no fabricated events**.

| Kind | Tier | Data source (desk field) | Fire threshold | Suppress / hysteresis |
|------|------|--------------------------|----------------|-----------------------|
| `regime-flip` | 1 | `gamma_flip`, `price` | γ-flip cross **confirmed** ≥ 3 pts beyond flip | inside the ±3 pt band → no fire (anti flip-flop) |
| `wall-break` | 1 | `gex_walls` king call/put, `price` | spot breaks a king wall AND **holds 3 consecutive polls** | resets if spot returns; skipped while `gex_stale` |
| `macro-window` | 1 | `macro_events` + ET clock | econ catalyst enters **T-15m / release / reaction** | one event per (event, phase); date-only rows skipped (never faked clock) |
| `magnet-shift` | 2 | `gex_walls` (γ centre of mass) | |Δ centre| ≥ 10 pts **or** crosses spot | per-(kind, level) dedup |
| `pin-shift` | 2 | `useSpxPinForecast` (`pin`, `pinPct`, `pinBand`) | pin strike steps ≥ 5 pts | min-step gate |
| `wall-build` | 2 | `gex_walls` `net_gex` trajectory | |net_gex| grows/shrinks ≥ 35% | ≥ $250k noise floor; top-2 per tick |
| `vol-regime` | 2 | `vix`, `vix_term.structure` | VIX crosses 20 **or** term flips contango↔backwardation | transition-only |
| `flow-print` | 3 | `spx_flows` (`has_sweep`, `premium`) | aggressive sweep ≥ $1.0M premium | non-sweep / sub-floor dropped; id dedup |
| `session-phase` | 3 | ET session clock | crosses 10:00 / 14:00 / 15:00 ET | one event per boundary |
| `play-state` | 3 | `useSpxPlay` (`action`, `open_play`) | play arms / fires / closes | lifecycle transition only |

Each signal carries a **SEVERITY TIER** (1/2/3), a **MAGNITUDE** payload (points / $ γ-notional /
% / premium / contracts, pre-formatted), an **IMPLICATION** line ("dealers now amplify moves"),
and a one-line **WHY** (expand chevron).

## Curation (pure, in `vector-pulse.ts`)

1. **Per-key cooldown** — `filterFreshPulseSignals` (existing, 4-min default).
2. **(kind, level) dedup** — `dedupeByKindLevel`, 90-s window: a wall that builds/ticks/builds at
   7,530 prints once.
3. **Global rate cap** — `applyGlobalRateCap`, ≤ 6 **non-Tier-1**/min. **Tier-1 always passes** and
   never consumes the budget (a regime flip is never dropped for volume).

## Rail (`SpxPulseRail`)

Header `⚡ PULSE` + LIVE stamp (dims to `QUIET` when the feed goes stale) → regime chip
(`SHORT GAMMA · UNSTABLE · −$1.8B γ`) → filter chips (All / Regime / Walls / Flow / Macro /
Plays). A **pinned Tier-1 section** stays on top; then the newest-first **stream**. Each row:
type icon + colored accent rail + TYPE badge + bold WHAT + dim IMPLICATION + mono magnitude chips
+ right-side timestamp + `→ chart` (stub affordance) + expand chevron (WHY). **Color by type**:
regime=amber, walls=blue, pin/magnet=purple, flow=cyan, vol=orange, macro=red, play=green. Honest
**quiet footer**: "structure holding — no Tier-1 events since HH:MM". Live polish: flash-on-new,
staleness dimming, `tabular-nums`, `prefers-reduced-motion`, keyboard-accessible buttons, no
layout shift. FOCUS mode → slim vertical strip (effects keep accumulating).

## Files

- `src/features/vector/lib/vector-pulse.ts` — additive: new kinds, `tier`/`magnitude`/
  `implication`/`why`/`level` on `PulseSignal`, `TIER_BY_KIND`, `dedupeByKindLevel`,
  `applyGlobalRateCap`.
- `src/features/spx/lib/spx-pulse.ts` — SPX→Pulse adapter + pure detector + wall-break tracker.
- `src/features/spx/lib/spx-pulse-view.ts` — pure color/badge/filter mapping.
- `src/features/spx/components/SpxPulseRail.tsx` — the rail.
- `src/features/spx/components/SpxIntelRail.tsx` — Pulse⇄Largo toggle host (default Pulse).
- `src/features/spx/components/SpxDashboard.tsx` — mounts `SpxIntelRail` in place of `SpxCommentaryRail`.
- `src/app/globals.css` — `.spx-pulse-*` styles.
- Tests: `spx-pulse.test.ts`, `spx-pulse-view.test.ts`, additions to `vector-pulse.test.ts`.
