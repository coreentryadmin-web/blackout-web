# Vector — CTO Product Audit (2026-08-05)

Author: agent session, following the Vector bead-density root-cause/fix (PR #1708, merged +
verified live 2026-08-05). Scope: `src/features/vector/**`, `src/app/(site)/vector/`,
`src/app/api/market/vector/**`, `src/app/api/cron/vector-*`. This is a strategic product review,
not a bug report — no code changes accompany this doc.

**Update (same day, post-review):** both P0 items below turned out to need less than the audit
assumed. §4 P0 item 1 (GEX ladder DTE-horizon scoping) was **already fully implemented** as of
PR #1197 — the audit's "gap" was a stale TODO comment (`VectorGexLadder.tsx`/the ladder route),
not a real gap; the code (`getHorizonStrikeTotals`, `vector-dte-walls-server.ts`) already re-scopes
the ladder to the chart's DTE toggle. That comment is now corrected. §4 P0 item 2
(`vector-play-engine.ts` unconsumed) was half-right: the engine already feeds BIE/Largo's context
(`vector-full-state.ts`), but nothing rendered its output as a visible chart-page card — that half
is now built (see `docs/audit/FINDINGS.md`, 2026-08-05 "Vector Suggested Play card" entry): a new
`VectorPlayCard` in the Pulse rail, fed by a new `onPlayChange` emission from `VectorChart.tsx` that
assembles the same `VectorSnapshot` BIE already reads and calls the existing, already-tested
`buildVectorPlay`. Lesson for future audits of this codebase: a "no consuming UI found" or
stale-looking TODO comment is exactly the class of thing this repo has been bitten by before
(see the pin-projection and oscillator-menu stale comments noted in §3) — verify against the route/
lib code directly, not just the component tree, before calling something a gap.

## 1. What Vector is, in one paragraph

Vector is the platform's live dealer-positioning chart: a candlestick chart with GEX/VEX wall
"beads" (call/put wall levels rendered as strength- and persistence-scaled markers that
accumulate into trails over the session), a gamma-flip line, king anchor, max-pain, expected-move
band/cone, EOD pin projection, full TA (MAs, RSI/MACD, key levels, market structure, confluence),
a strike-ladder side rail, a narrated "Pulse" terminal, member-defined alerts, and a universe
scanner — gated behind premium tier, servable on ANY optionable ticker (not just a preset list),
with 5s cadence on the oracle set (SPX/SPY/QQQ) and 15s elsewhere. Full feature list: see the
inventory sweep appended at the bottom of this doc.

## 2. Strengths worth protecting

1. **"Real-data-only, never fabricated" is a consistent, load-bearing product policy** — EM cone,
   gamma-regime glow, GEX heatmap, max pain, expected move, and bead "birth" markers all
   deliberately degrade to *nothing drawn* rather than interpolate/guess. This is unusual
   discipline for a trading-signal product and is a genuine trust differentiator vs. competitors
   who paper over gaps. Any new feature should inherit this bar.
2. **Bead trails are now correct end-to-end** (post #1708): viewer-independent 5s recording for
   the whole ~100-ticker universe, 15s for on-demand tickers, 1-min HTTP backup cron. This closes
   the single biggest credibility gap Vector had (SPY/QQQ/NVDA beads looking "broken" next to
   SPX).
3. **Vector is deliberately un-gated by ticker allowlist** — any optionable symbol works, with the
   allowlist only controlling *cache-warming priority*, not access. This is the right default for
   a premium power-user tool and should not be walked back for infra-convenience reasons.
4. **Genuinely dense feature surface for one page**: wall integrity scoring (firm/moderate/thin),
   gamma magnet, wall proximity, confluence zones, and the Pulse terminal's plain-English
   narration all convert raw GEX math into an actionable read — this is closer to "a trader sits
   next to you" than a typical GEX-visualization tool.
5. **Embed seam already exists** (chart-only mode powers SPX Slayer) — Vector's chart is already
   a reusable primitive, not a monolith, which lowers the cost of the cross-surface ideas below.

## 3. Gaps and risks

1. **GEX ladder ignores the DTE horizon toggle** (`VectorGexLadder.tsx:46`, acknowledged TODO) —
   a member who switches the chart to 0DTE still sees a blended "all-expiry" ladder next to
   0DTE-scoped walls/flip/max-pain on the same screen. This is a real, member-visible
   inconsistency, not cosmetic: the two panels can disagree on which strike is "the" wall.
2. **Two built-but-seemingly-unconsumed engines**: `vector-play-engine.ts` (fuses regime + magnet
   + proximity + EM + confluence + integrity into one concrete trade idea — entry/targets/stop/
   conviction) and `vector-coaching.ts` (urgency-graded alert drafts) exist, are tested, but no
   consuming UI component was found in this sweep. Either they feed a surface outside this sweep's
   scope (SPX Slayer / Night Hawk) or they are dead/half-wired capability sitting unused on the
   member-facing product. Worth 30 minutes to confirm which, before building anything net-new —
   the play-engine in particular looks like it could BE the single highest-leverage Vector feature
   (a synthesized recommendation, not just raw overlays) if it isn't already shipped somewhere.
3. **Push notifications only fire while the tab/process is alive** — a member who closes the tab
   gets nothing, even though device push subscription is already collected "for later." This is a
   documented, scoped-out follow-up (needs a server-side rule evaluator + cron + `sendWebPush`),
   but it's the single most-requested class of feature for any alerting product ("tell me when I'm
   not looking") and currently silently under-delivers on its own opt-in promise.
4. **No multi-day/higher timeframe view** (4h/1D/1W) — explicitly scoped out pending a daily-bar
   feed. This caps Vector to an intraday-only tool; a member can't see "is this wall in the same
   place it was yesterday" without leaving the product.
5. **No volume profile** — indicator menu comment references "profiles" as an unbuilt follow-up.
   For a dealer-positioning-flow product, a session/composite volume profile pairs naturally with
   wall trails (volume-at-price vs GEX-at-strike is a classic confluence read) and is conspicuously
   absent given how much else is already built.
6. **`VectorChart.tsx` is a ~3,800-line single file** owning chart lifecycle, every overlay's
   draw/diff logic, SSE subscription, replay slicing, and alert dispatch. This isn't a
   member-facing issue today, but it is the highest-risk file in the product from a
   velocity/regression standpoint — exactly the kind of file where the client/server-boundary bug
   caught during the bead-density work (a shared import silently breaking prod builds) is likely
   to recur as more overlays are added. Recommend splitting overlay draw/diff functions into
   per-overlay modules (each already has a `vector-*.ts` logic module; the draw/diff halves should
   live next to them) before the next 2-3 overlays are added, not after.
7. **No cross-ticker / cross-session comparison** — every view is single-ticker, single-session.
   A member watching a sector rotation thesis (e.g., "is NVDA's wall structure diverging from SMH's
   today") has to open multiple tabs and eyeball it.

## 4. Enhancement roadmap (prioritized)

**P0 — finish what's already half-built (low effort, real member-visible payoff)**
- Horizon-scope the GEX ladder to match the chart's DTE toggle (closes gap #1). Small, contained
  change; the ladder already re-fetches on a timer, just needs the DTE param threaded through.
- Confirm/wire `vector-play-engine.ts` output into the Vector UI itself (e.g., a "Suggested Play"
  card in the Pulse rail) if it isn't already surfaced elsewhere — this converts Vector from "here
  is the data" to "here is the trade," which is a materially higher-value pitch to a premium member
  and the fusion logic already exists and is tested.

**P1 — the biggest gap in the alerting story**
- Server-side alert evaluation + `sendWebPush` cron so wall-touch/flip-cross alerts fire to a
  closed tab/phone, matching what the client-side rule engine and device-subscription plumbing
  already promise. This is scoped and designed for in the existing TODO — it's an execution gap,
  not a design gap.

**P2 — extend the analytical surface**
- Volume profile overlay (session + composite), positioned as a companion to the existing wall
  ladder — natural pairing, no new data source needed (bars are already seeded).
- ~~Daily/weekly bar seed to unlock 4h/1D/1W timeframes~~ — **1D/1W built** (see
  `docs/audit/FINDINGS.md`, 2026-08-05 "Vector Daily/Weekly historical chart view"): a new
  `VectorDailyChart` surface reusing the already-shipped `fetchStockDailyBars`/`fetchIndexDailyBars`
  Polygon fetchers (no new data source needed, contrary to this audit's original framing that a
  daily-bar feed didn't exist yet — it did, just not wired into Vector). **4h remains open** — it
  needs a separate multi-day INTRADAY bar feed, a materially bigger lift than the daily-close data
  1D/1W reused.
- Cross-ticker wall-structure comparison view (e.g., a small multi-ticker mini-ladder strip — SPY
  vs sector ETF vs top 2-3 constituents) for relative-positioning reads, reusing the existing
  scanner's per-ticker regime/wall summary rather than a new data path.

**P3 — architecture hardening (protects future feature velocity)**
- Split `VectorChart.tsx`'s per-overlay draw/diff code into the same per-overlay `vector-*.ts`
  modules that already hold each overlay's pure logic, so the file stops being the single point
  where a stray import can break the whole build (as happened, and was caught, during #1708).
- Land a lightweight "which files are client-safe vs server-only" lint/import-boundary check
  (e.g., an ESLint `no-restricted-imports` rule keyed off a `-server.ts` naming convention, which
  the bead-density fix already established) so the next accidental server-import-into-client-file
  regression fails locally/in CI before reaching a PR reviewer.

## 5. Full feature/architecture inventory (research sweep, verbatim)

<details>
<summary>Expand full inventory</summary>

### Chart core
- **Candlestick price chart** — lightweight-charts based, multi-session seed (SPX/SPY/index/stock minute bars). `VectorChart.tsx`.
- **Volume histogram** — dedicated sub-pane below price (SPY 1m share-volume proxy merged onto SPX bars for SPX). `VectorChart.tsx`, `vector-spy-volume-merge.ts`, `vector-spy-volume.ts`.
- **Timeframe picker** — 1/3/5/15/30/60 min presets, client-aggregated from 1m seed + live ticks. `VectorTimeframeSelect.tsx`, `vector-bar-timeframes.ts`.
- **Replay mode** — scrub/play/pause/step/jump/speed(0.5-8x)/loop over bars+wall history; time-travels every overlay. `VectorReplayControls.tsx`, `vector-replay.ts`.
- **Crosshair legend** — hover readout of close/flip/walls/dark-pool/nearest GEX heatmap cell. `VectorCrosshairLegend.tsx`.

### Dealer-positioning overlays
- **GEX/VEX wall ladder-as-beads** — strength-scaled bead markers, birth/rebirth/death lifecycle, integrity ring. `VectorChart.tsx`, `vector-wall-visual.ts`, `vector-wall-integrity.ts`, `vector-wall-rail-primitive.ts`.
- **GEX/VEX lens toggle**. `VectorLensToggle.tsx`.
- **Gamma/Vanna flip line**. `applyFlipGuide`.
- **DTE horizon toggle** (0DTE/Weekly/Monthly; "all" removed from member UI 2026-07-13). `VectorDteToggle.tsx`, `vector-dte-horizon.ts`.
- **Bead trails / wall history rail** — per-ticker per-horizon time series, modeled prefix ghosts. `vector-wall-history.ts`, `vector-wall-sample.ts`, `vector-wall-persist.ts`, `vector-wall-db.ts`, `vector-narrowed-wall-core.ts`, `vector-walls-warm.ts`.
- **King anchor**. `vector-king-anchor.ts`.
- **Max-pain line**. `vector-max-pain.ts` / `-server.ts`.
- **GEX heatmap background primitive**. `vector-gex-heatmap-primitive.ts`, `-paint.ts`, `vector-gex-reconstruct*.ts`, `-server.ts`.
- **Gamma-regime boundary glow** (default off). `vector-gamma-regime-primitive.ts`, `-paint.ts`.
- **Strike-ladder side panel** — per-strike net-GEX bars, updates spot 1s/structure 5-15s; not yet DTE-horizon-scoped. `VectorGexLadder.tsx`.
- **Dark-pool markers** (max 6, SPY-to-SPX scaled). `vector-dark-pool-levels.ts`, `-cache.ts`.
- **Options-flow markers** (opt-in, default off). `vector-flow-markers.ts` / `-server.ts`.

### Expected move / pin
- **Expected move band (±1σ/2σ)**. `vector-expected-move.ts`, `-atm.ts`, `-server.ts`.
- **EM cone** (time-converging). `vector-em-cone.ts`, `-primitive.ts`.
- **EOD Pin projection** (Monte-Carlo p10-p50-p90 cone). `applyPinProjection`, `vector-pin-cone-primitive.ts`.

### TA
- MAs (VWAP/EMA 9-21-50/SMA 50-200), RSI(14)/MACD(12-26-9), key levels (HOD/LOD/OR/Fib/PDH-PDL-PDC/pivots), market structure (HH/HL/LH/LL + BOS/CHOCH), confluence zones. `vector-indicators.ts`, `vector-key-levels.ts`, `vector-fib-swing.ts`, `vector-market-structure.ts`, `vector-structure-markers.ts`, `vector-confluence.ts`.

### Terminal / narration
- **VectorPulse** desk terminal (tone-coded narration of wall/flow/regime/alert events). `VectorPulse.tsx`, `vector-pulse.ts`.
- **Regime banner**, **wall proximity**, **gamma magnet**, **wall integrity scoring**, **always-on technicals readout**, **GEX shift-leaders strip**.

### Alerts
- In-page rules (rising-edge + cooldown, localStorage-persisted). `VectorAlertsPanel.tsx`, `vector-alerts.ts`, `-store.ts`.
- OS/browser push — **client-only today** (tab must stay open); server-side evaluator is a documented follow-up. `vector-notify.ts`, `-client.ts`.

### Discovery / navigation
- Ticker search (any optionable symbol). `VectorTickerSelect.tsx`, `vector-ticker.ts`.
- Universe scanner (4 presets, 5s poll). `VectorScanner.tsx`, `vector-screener.ts`, `vector-universe.ts`.
- Freshness chip; iOS native Chart/Pulse/Ladder/Scanner tab switcher.

### Cross-surface seams
- Chart-only embed mode (powers SPX Slayer). Shared price-axis seam. Pulse-to-chart focus flash. Plays-on-chart lines. `vector-play-levels.ts`.
- `vector-play-engine.ts` — fuses regime+magnet+proximity+EM+confluence+integrity into one trade idea; no confirmed consuming UI found in this sweep.
- `vector-coaching.ts` — urgency-graded alert drafts; no confirmed consuming UI found in this sweep.

### Architecture
```
app/(site)/vector/page.tsx (requireTier("premium") + canAccessTool("vector"))
  └─ VectorPageShell.tsx
        ├─ VectorTickerSelect
        ├─ VectorChart.tsx (dynamic, ssr:false)
        │     ├─ VectorToolbar (Timeframe, IndicatorMenu, Replay, Lens, DTE toggle)
        │     ├─ VectorCrosshairLegend
        │     └─ VectorRegimeBanner
        ├─ VectorGexLadder.tsx
        ├─ pulseRail: GexShiftLeadersStrip, VectorPulse, VectorAlertsPanel
        └─ VectorScanner.tsx
```
`VectorChart.tsx` (~3,800 lines) owns chart lifecycle + every overlay's draw/diff + SSE + replay
slicing + alert dispatch — the single largest/highest-risk file in the feature.

### Universe / tiering
- Static allowlist (~21 tickers) gates UW-overlay fetch priority + always-on wall-history
  recording, NOT chart access. Oracle set (SPX/SPY/QQQ) gets live UW WS push + 5s cadence +
  default 0DTE horizon. Dynamic universe (platform-wide, ≤100 tickers, 14-day retention) extends
  warm-cache coverage on demand. Any syntactically valid ticker is servable, cold-fetched from
  Polygon if not cache-warm. Access itself is gated only by premium tier + the `vector` tool flag.

</details>
