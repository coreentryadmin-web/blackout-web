# Cross-product tools unreachable: defined in LARGO_TOOL_DEFS but not in TOOL_GROUPS.platform

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED in `fix/cross-product-tool-routing` |
| **Severity** | P1 — new tools completely unreachable, routing blocked |
| **Surface** | `src/lib/largo/tool-defs.ts` TOOL_GROUPS.platform |

## Root cause

Phase 2d P1 shipped two new cross-product tools with full implementations:
- `get_cross_product_ranking` (tool-defs.ts lines 710-722)
- `get_live_multiproduct_board` (tool-defs.ts lines 724-732)

Both tools were added to LARGO_TOOL_DEFS array and wired in run-tool.ts. However, they were **never added to `TOOL_GROUPS.platform`**, which is Largo's routing lookup table. When Largo sees a question about cross-product ranking, it does not have these tools in its available-tools list, so the question either:
1. Gets routed to wrong tools (individual product tools, not cross-product)
2. Returns "I don't have that capability"
3. Hallucinates an answer without calling tools

The tools are fully implemented but completely unreachable due to this single line omission.

## Fix

Added both tools to `TOOL_GROUPS.platform` array at the cross-product comparison section, after `get_spx_vs_nighthawk_comparison` and before `...BIE_TOOL_NAMES` spread. This makes them discoverable to Largo's intent router.

```typescript
// Cross-product comparison — routed here (not spx_desk) so it's reachable
// whenever NIGHTHAWK_RE fires, same as the two tools above it.
"get_spx_vs_nighthawk_comparison",
// New Phase 2d cross-product tools (Phase 2d P1)
"get_cross_product_ranking",
"get_live_multiproduct_board",
```

## Evidence

- `npx tsc --noEmit` clean
- `npx tsx --test src/lib/largo/tool-defs.test.ts` 54/54 pass
- No new dependencies or implementation changes
- Routing test assertion `SPX_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.platform` still passes (these tools are not in SPX_ENGINE_TOOL_NAMES, as intended)

## Blast radius

Only TOOL_GROUPS.platform lookup. No changes to implementations, run-tool.ts, or tool contract. Largo will now route cross-product questions to these tools instead of refusing or misrouting.

## Why this happened

Tool registration has two stages: (1) define in LARGO_TOOL_DEFS (gives schema to Claude), (2) add to TOOL_GROUPS mapping (makes it discoverable). The PR merged with stage 1 complete but stage 2 forgotten — a gap similar to the tool-wiring oversight found in several earlier Largo tools.
