# Largo Truncation: 3 of 6 Tools Still Exceeding 16KB Cap

> **kind:** FINDINGS

**Date:** 2026-08-29  
**Root Cause:** Undersized caps from PR #3159 (measured production sizes + JSON overhead not accounted for)  
**Status:** FIXING (caps re-reduced)

---

## Discovery

Live truncation probe (2026-08-29 21:13 UTC) run 20 minutes after PR #3159 deployed confirmed that three of the six "fixed" tools are STILL returning truncated tool results to Largo:

**TRUNCATED (Still):**
- ❌ `get_screener` — 6-entry cap insufficient
- ❌ `get_group_greek_flow` — 15-row cap insufficient  
- ❌ `get_market_oi_change` — 15-entry cap insufficient

**COMPLETE (Fixed):**
- ✅ `get_confluence_outcomes` — 30/outcome cap working
- ✅ `get_market_stats` — Major indices only, working
- ✅ `get_platform_snapshot` — fitSpxStructureForModel applied, working

---

## Root Cause

PR #3159's measured sizes were correct (1956 bytes/screener entry, 708 bytes/greek flow row, 635 bytes/OI entry), but the JSON overhead + wrapper overhead was underestimated:

**Screener example:**
- 6 entries × 1956 bytes = 11,736 bytes of data
- Plus JSON field names, brackets, commas, wrapper overhead = ~14-15KB total
- Approaches/exceeds 16,384 byte cap when wrapped in tool result transport

**The test (`market-data-fits.test.ts`) passed** because:
1. Test fixtures may not include all fields from real production API responses
2. Actual production data sizes may be larger than measured
3. Test checks only the fitted result, not the full tool result wrapper overhead

---

## Fix (This Session)

Reduced caps further to account for complete overhead:

| Tool | PR #3155 Cap | PR #3159 Cap | This Fix | Measurement |
|------|---|---|---|---|
| `get_screener` | 15 | 6 | **3** | ~1956 bytes/entry |
| `get_group_greek_flow` rows | N/A | 15 | **8** | ~708 bytes/row |
| `get_market_oi_change` | 20 | 15 | **8** | ~635 bytes/entry |

**Rationale:** More conservative caps leave headroom for JSON overhead and prevent edge cases at the transport boundary.

---

## Caps Adjusted In

**`src/lib/largo/market-data-fits.ts`:**
- `fitScreenerForModel(raw, maxShown = 3)` (was 6)
- `fitGroupGreekFlowForModel(raw, maxShown = 8)` (was 15)
- `fitGroupGreekFlowRowsForModel(raw, maxShown = 8)` (was 15)
- `fitMarketOiChangeForModel(raw, maxShown = 8)` (was 15)

**`src/lib/largo/run-tool.ts`:**
- `fitMarketOiChangeForModel(raw, 8)` (was 15)
- `fitScreenerForModel(raw, 3)` (was 6)
- `fitGroupGreekFlowForModel(summary, 8)` (was 15)

---

## Next Validation

After this fix deploys, re-run truncation probe:

```bash
node --import tsx scripts/audit/largo-truncation-probe.mjs \
  --tools=get_screener,get_group_greek_flow,get_market_oi_change \
  --json
```

Expected: All three return `COMPLETE`.

---

## Lessons

1. **Test fixtures must match production.** A test that passes at 6 entries but production truncates at 6 means the test is measuring something other than what production does.

2. **Overhead is not negligible.** Measured entry size + JSON wrapper + transport wrapper can double the actual payload budget demand.

3. **Conservative is better.** When the exact cap is uncertain, go lower. Users rarely need ranks 4-6 or rows 9-15; top 3 or top 8 are sufficient for agent reasoning.

4. **Probe again after fix.** Each cap adjustment needs live validation, not just local testing.

---
