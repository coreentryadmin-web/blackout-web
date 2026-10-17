> **kind:** FINDING

## Ask Largo swing play-brief: Peak/Trough render a confident "0.0%" for a position with ZERO live ticks since commit, contradicting the same section's own "Mark: unknown" line — FIXED

| **Status** | Fixed (`src/lib/swing/play-brief.ts`'s `pnlSection`) |
|---|---|

**Found via:** this session's standing Ask Largo × Night Hawk Swings deep-dive (a 6-agent live workflow sweeping the swing play-brief against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points), 2026-10-17 ~17:30 UTC.

**Live repro.** `GET /api/market/swing/play-brief?playId=SWING:NVDA:62&ticker=NVDA` (committed 2026-10-16T20:37:25Z, no live-marks tick since — market closed over the weekend). The underlying ledger row has `contract.bid/ask/mid/gamma/theta/vega/iv` all `null`, `markAsOf: null`, `entryPremium === peakPremium === troughPremium === 4.50`, `livePnlPct: null`. The Position section rendered, three lines apart in the same section:
```
Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_
P&L:  **—**
Peak: **0.0%**
Trough: **0.0%**
```
The section first honestly admits no price is known, then two lines later states a specific, confident 0.0% reading for both the best and worst excursion the position has ever had. A member reading only Peak/Trough sees "this traded dead flat since entry" — a fabricated claim. The true state is "we have never observed a single price for this contract."

**Root cause.** `src/lib/swing/play-brief.ts`'s `pnlSection` (~lines 495-524) already computes `markGenuinelyUnknown` (via the shared `optionMarkGenuinelyUnknown`, `play-brief-absence.ts` — true when `markIsSync && pnlPct == null`, the documented "true entry-fallback" signature) and already gates the **Mark** line with it. The **Peak** and **Trough** lines, however, called `fmtPct(peakForDisplay)`/`fmtPct(troughForDisplay)` unconditionally whenever `play.peak`/`play.trough` were non-null, with zero reference to `markGenuinelyUnknown`. A position that has never received a live tick has its peak/trough watermarks still seeded at the commit-time entry premium (FINDINGS 2026-08-06's "seed peak/trough at entry" fix) — so `play.peak`/`play.trough` compute to exactly `0` (0% move from entry to entry), a real, non-null number that `fmtPct` happily renders as `"0.0%"` rather than `"—"`.

**Scope confirmed board-wide, not a one-off.** Live sweep of the full committed SWING book (`GET /api/market/nighthawk/horizons?view=swings`) found **9 of 63 committed positions (14.3%)** satisfying `peakPremium === troughPremium === entryPremium && livePnlPct === null` at the time of the sweep: NVDA:62, AR:1957, SNDQ:1956, LABD:1955, UVIX:1954, VXX:1953, UVXY:1952, SQQQ:1951, SOXS:1950 — all committed in the same 2026-10-16 16:15-16:37 ET window (right before/at Friday's close) and un-ticked for the entire weekend since. Every one of these would have shown the same false "0.0%" to any member who opened Ask Largo on them.

**Fix.** Gate the Peak and Trough lines the same way the Mark line already is: when `markGenuinelyUnknown` is true, render `"Peak: **—** _(no live tick yet)_"` / `"Trough: **—** _(no live tick yet)_"` instead of the formatted percent. This is a direct instance of the Largo product contract's C3 (absence) principle — omit/qualify rather than fabricate — applied to a section that had the right signal in scope but wasn't using it for these two lines.

**Tests.** New test in `src/lib/swing/play-brief.test.ts` ("Position section does not render a confident '0.0%' Peak/Trough when the position has never received a live tick (live NVDA:62 repro 2026-10-17)"): constructs the exact NVDA:62 shape (`markIsSync: true, pnlPct: null, peak: 0, trough: 0`) and asserts Peak/Trough no longer render `0.0%` and instead show the honest "no live tick yet" line, while the existing Mark-line behavior is unchanged. RED→GREEN proven via `git stash` of `play-brief.ts` alone (1 failure without the fix — the new test — 0 with it restored). Full `src/lib/swing` suite: 1816/1816 pass. `tsc --noEmit`: clean.

**Blast radius:** `pnlSection` is the sole renderer of the Position section's Peak/Trough lines (verified via grep — no duplicate implementation elsewhere in `src/lib/swing/`). The existing Mark-line gating, the P&L line, and every other section of the brief were already correct and are untouched by this change.
