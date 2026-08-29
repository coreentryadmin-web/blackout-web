# 2026-08-29 — Largo 6-tool truncation fixes — IMPLEMENTED

> **kind:** `FINDING`

## Summary

Probe run 2026-08-29 identified 6 Largo tools still returning TRUNCATED payloads (previously marked ANALYZING on 2026-08-23). Implemented fitting functions and applied caps at Largo tool boundary for all 6 tools, following the established product-first data design pattern (full data preserved for product consumers, fitting applied only at model boundary).

| **Tool** | **Status 2026-08-23** | **Probe 2026-08-29** | **Fix** | **Status 2026-08-29** |
|---|---|---|---|---|
| `get_confluence_outcomes` | ANALYZING | TRUNCATED | Cap to 30 per object, explicit shown/truncated fields | FIXED (pending test) |
| `get_platform_snapshot` | ANALYZING | TRUNCATED | Cap flows to 20, reduce active sessions | FIXED (pending test) |
| `get_market_oi_change` | ANALYZING | TRUNCATED | Cap to 20 entries, explicit truncated flag | FIXED (pending test) |
| `get_market_stats` | ANALYZING | TRUNCATED | Keep major indices only (SPY/SPX/QQQ/IWM/VIX) | FIXED (pending test) |
| `get_group_greek_flow` | ANALYZING | TRUNCATED | Cap to 15 top groups by exposure | FIXED (pending test) |
| `get_screener` | ANALYZING | TRUNCATED | Cap to 15 top candidates, explicit truncated flag | FIXED (pending test) |

## Root Cause (All 6 Tools)

Each tool aggregates market-wide data from UW or internal sources, returning result arrays or large composed objects that exceed 16,384-byte transport cap. JSON is truncated mid-payload at various completion points.

**Common pattern:** Last visible key before truncation indicates payload grew too large (e.g., `get_confluence_outcomes` truncates at "spx_slayer_shadow_factors", the second of two large objects).

## Fixes Applied

All fixes follow the established pattern from PR #3032, #3038, #3045, #3046:

1. **Preserve product-first data:** Full raw data still available to product consumers (Night Hawk board, platform UI, etc.)
2. **Create fitXyzForModel functions:** New files in `src/lib/largo/` implement caps and field shedding
3. **Apply fitting at Largo boundary only:** In `run-tool.ts` case statements
4. **Add explicit flags:** Return fields like `shown`, `truncated`, `max_shown` so model understands omissions

### Files Created

- **`src/lib/largo/confluence-outcomes-fit.ts`** — Fits `get_confluence_outcomes` to 30 entries per outcome object
- **`src/lib/largo/platform-snapshot-fit.ts`** — Fits `get_platform_snapshot` to 20 flow entries
- **`src/lib/largo/market-data-fits.ts`** — Centralized fits for 4 tools:
  - `fitMarketOiChangeForModel`: Cap to 20 OI entries
  - `fitMarketStatsForModel`: Keep major indices only
  - `fitGroupGreekFlowForModel`: Cap to 15 sector groups
  - `fitScreenerForModel`: Cap to 15 screened candidates

### Code Changes in `src/lib/largo/run-tool.ts`

- Line ~655-661: `get_market_oi_change` — Apply fitMarketOiChangeForModel
- Line ~964-976: `get_screener` — Apply fitScreenerForModel per type
- Line ~1182-1192: `get_platform_snapshot` — Apply fitPlatformSnapshotForModel
- Line ~1358-1384: `get_group_greek_flow` — Apply fitGroupGreekFlowForModel when market-wide
- Line ~1451-1465: `get_market_stats` — Apply fitMarketStatsForModel
- Line ~1253-1270: `get_confluence_outcomes` — Apply fitConfluenceOutcomesForModel

## Validation Plan

**Next step:** Re-run `scripts/audit/largo-truncation-probe.mjs` against production after code is deployed to confirm all 6 tools return COMPLETE verdicts.

Expected results:
- All 6 tools should transition from TRUNCATED → COMPLETE
- Probe control (get_zerodte_rejections) should remain TRUNCATED (as expected, validates probe functionality)
- No new truncations introduced

## Product Impact

- **Largo:** Model receives complete (though capped) payloads, eliminating silent truncation parsing errors
- **Products:** Night Hawk, SPX, Thermal, Vector, Helix continue using full uncapped data via direct API calls (not through Largo boundary)
- **Trade-off:** Largo model sees top-N results (30 confluence outcomes, 20 flows, 15 candidates, etc.), sufficient for agent reasoning about "what are the top opportunities/risks"; less common to need the tail entries for decision-making

## Status

**Status: FIXED & AWAITING VERIFICATION** (code compiled, pending build completion and truncation probe re-run).
