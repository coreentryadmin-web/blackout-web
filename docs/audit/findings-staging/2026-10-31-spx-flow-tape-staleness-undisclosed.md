> **kind:** FINDING

## SPX Slayer's closed-market branch discloses GEX/VWAP staleness but serves flow/tape-derived factors ("0DTE flow", "HELIX sweeps", "Live tape", "Net prem") with zero freshness check at all — FIXED

| | |
|---|---|
| **Area** | SPX Slayer / Night Hawk — `evaluateSpxPlayCore`'s closed-market branch (`src/features/spx/lib/spx-play-engine.ts`), fed by `desk.flow_0dte_net`/`desk.spx_flows`/`desk.unified_tape`/`desk.net_prem_ticks` (`src/features/spx/lib/spx-signals.ts`) |
| **Status** | FIXED |
| **Severity** | P2 (member-facing signal correctness — hours-old flow data presented as a live, scored read with zero disclosure; no financial loss by itself, since the closed-market branch never opens a real position, but it directly misinforms the "Session closed" SCANNING card's thesis/score/play-idea, and here the undisclosed factor was 35% of the published score) |

### Root cause

`computeSpxConfluence` (`src/features/spx/lib/spx-signals.ts`, line 581) scores a `"0DTE flow"`
factor (`weight: ±14`) straight off `desk.flow_0dte_net` whenever `|flow_0dte_net| > 150_000`, with
no freshness check of any kind — `desk.flow_data_age_ms` (the field that carries the real answer)
is never read here. The same gap exists for `"Live tape"` (line 709, built from
`desk.unified_tape`) and `"Net prem"` (line 746, built from `desk.net_prem_ticks`).

`evaluateSpxPlayCore`'s closed-market branch (`src/features/spx/lib/spx-play-engine.ts`, ~line
1694) builds its SCANNING card's score/thesis/play-idea off exactly this confluence object. Unlike
GEX (`discloseStaleGexFactors`, shipped 2026-10-26) and VWAP (`discloseStaleVwapFactor`, shipped
earlier today, 2026-10-31), there was no boolean on `SpxDeskPayload` for flow staleness at all to
even gate a disclosure on — `desk.flow_data_age_ms` is read nowhere in this branch (only in a debug
log at a different line, ~1072). Meanwhile the live-market gate stack already treats stale flow as
serious enough to hard-block a BUY: `evaluatePlayGates` (`src/features/spx/lib/spx-play-gates.ts`,
~line 466) blocks a BUY-intent entry once `flow_data_age_ms > 300_000` (5 min) with no live
SPX/SPXW flow-cohort heartbeat — but that gate object is never consulted in the closed-market
branch (the same structural gap the GEX/VWAP fixes each independently closed for their own
factor).

### Evidence

Live production audit, 2026-10-31 (Saturday, market genuinely closed): `GET /api/market/spx/desk`
returned `flow_0dte_net: 1,892,691,448`, `flow_data_age_ms: 62,672,013` (~17.4h),
`flow_cluster_live: false`. The same-session `GET /api/market/spx/play` returned
`grade: "C"`, `score: 40`, with a `"0DTE flow"` factor (`weight: 14`, `detail: "Call premium
leading 0DTE tape"`) — 35% of the published score, enough to move the published grade from C to D
if excluded — and **no staleness clause anywhere in the response**. `gex_stale`/`vwap_stale` were
both `false` in this same snapshot, confirming the GEX/VWAP disclosure mechanisms are working
correctly for the factors they cover; the gap is specifically the absence of an equivalent
mechanism for flow/tape.

RED→GREEN proven directly on the two changed source files (`spx-play-engine.ts`,
`spx-play-gates.ts`; test file kept as the fix): with the sources reverted to their pre-fix
content, the 2 new tests failed — `evaluateOpenPlay closed-market SCANNING, stale flow ...`
(factor detail stayed `"Call premium leading 0DTE tape"`, no `/Flow stale, not live/` match) and
the GEX+VWAP+flow composite test (same reason) — while the other 13 tests in the same file,
including the pre-existing GEX/VWAP disclosure tests, still passed, isolating the failure to the
missing flow disclosure specifically. Restoring the fix turned both green with no other
regressions. Full `src/features/spx/lib/*.test.ts` suite (906 tests) and `npx tsc --noEmit` both
clean after the fix, on Node 20.

### Blast radius

- `src/features/spx/lib/spx-play-gates.ts`'s live BUY-intent hard-block (`flowAgeMs > 300_000 &&
  !clusterLive`) is refactored into a named, exported pure predicate (`isFlowDataStale`,
  `FLOW_HARD_STALE_MS`) rather than left as an inline literal — the closed-market disclosure below
  calls the exact same function, so the live threshold and the closed-market disclosure threshold
  can never drift apart. The live gate's own behavior is unchanged (same 300_000ms boundary, same
  `!clusterLive` override); covered by the pre-existing `spx-play-gates.test.ts` suite, which still
  passes unmodified.
- `src/features/spx/lib/spx-play-engine.ts`'s closed-market branch gains a third, independent
  disclosure check (`closedFlowFactorStale`) that composes with the existing GEX/VWAP checks into
  the same `"· <clause> · <clause>"` suffix on `thesis`/`gates.play_idea`, and the same per-factor
  `detail` append on `factors[]` — covered by a new three-way composition test (GEX + VWAP + flow
  all stale at once) alongside the existing two-way (GEX + VWAP) one.
- `FLOW_DERIVED_FACTOR_LABELS` names all four flow/tape-derived factor labels (`"0DTE flow"`,
  `"HELIX sweeps"`, `"Live tape"`, `"Net prem"`) for completeness, even though only `"0DTE flow"`
  was confirmed live in this snapshot — `"HELIX sweeps"` is structurally self-limiting to sweeps
  alerted within the last 30 minutes of wall-clock time (`matchingHelixSweepFlows`,
  `spx-signals.ts`), so it cannot fire on genuinely stale data in practice, but is included so the
  disclosure set matches the full data family rather than only the one factor this particular
  snapshot happened to trip.
- Every other consumer of `desk.flow_0dte_net`/`desk.flow_data_age_ms` (lotto/power-play catalysts,
  the terminal lines, the shadow-matcher, the debug log) is unaffected: this fix touches only the
  closed-market branch's presentation layer, not the shared desk fields themselves.

### Fix rationale

Extracted the live gate's existing `flowAgeMs > 300_000 && !clusterLive` condition into
`isFlowDataStale` (`spx-play-gates.ts`), the same "extract once, consult from both paths" idiom
`mixedTapeGateMessage` already established in this file for the mixed-tape check (2026-10-26) —
rather than inventing a second threshold or a new boolean field on `SpxDeskPayload` the way GEX/VWAP
each did. GEX and VWAP needed a new field because nothing on the desk payload captured their
provenance; flow already has a precise, real-valued signal (`flow_data_age_ms` +
`flow_cluster_live`) and an existing, already-tuned threshold (the live BUY block) — reusing it
avoids calibrating a fourth number from scratch and keeps the live/closed-market treatments of
"how stale is too stale" permanently in sync.

In `evaluateSpxPlayCore`'s closed-market branch, added `discloseStaleFlowFactors` as a third
sibling of `discloseStaleGexFactors`/`discloseStaleVwapFactor` — same idiom (append `" — Flow
stale, not live"` to the factor's own `detail`), gated on `isFlowDataStale(desk.flow_data_age_ms,
desk.flow_cluster_live === true)` **and** a flow-derived factor actually having fired (so a
closed-market read with none present never grows a staleness clause about data it never showed —
the same discipline the GEX/VWAP checks already apply). All three disclosure checks are
independent and compose into one shared clause list, covered by a new test proving all three fire
together without one overwriting another. Deliberately did **not** exclude or down-weight the
stale flow factor from the score — same design choice the GEX/VWAP fixes made ("once the market is
genuinely closed, stale and correct are the same thing" for the underlying number itself; the
defect was disclosure, not exclusion), so this fix follows the established pattern rather than
diverging from it.
