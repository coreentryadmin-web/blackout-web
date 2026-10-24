// Fitting for get_platform_snapshot Largo transport cap.
// Cross-product platform state exceeds 16k cap. Reduce flow limit and active session
// count for Largo; product consumers (UI, Night Hawk, etc.) use full data directly.
//
// `raw.spx` is `summarizeSpxDesk`'s full output — the SAME enrichment-tail-heavy shape
// `get_spx_structure` needed `fitSpxStructureForModel` to trim (spx-structure-fit.ts:
// unified_tape, news_headlines, macro_events, sector_heat, oi_changes, greek_exposure,
// macro_indicators, strike_stacks…). Copying it through unfitted was measured live
// (largo-truncation-probe.mjs, 2026-08-29) to still truncate `get_platform_snapshot`
// AFTER the flows-array cap below shipped — the flows array was never the whole
// problem, `raw.spx` alone can exceed the cap on its own. Reuses the existing SPX
// fitter rather than a second copy of the same row-cap table.
//
// MEASURED STILL TRUNCATED live 2026-10-17, AFTER the fix above: `get_platform_snapshot
// TRUNCATED 131690/16000`. Root cause: `fitSpxStructureForModel(raw.spx)` was called with
// NO budget override, so it defaults to the FULL `LARGO_RESULT_CHAR_BUDGET` (14000 chars) and
// fits `raw.spx` to the EDGE of that budget in total isolation — its own "HARD BOUND" backstop
// deliberately maximizes usage up to whatever budget it's given, so a rich live desk (full
// RTH flow/tape activity) legitimately lands `fitted.spx` close to 14000 bytes on its own. Then
// `nighthawk` and the (already-capped) `flows` array get added ON TOP of that already-full
// budget, guaranteeing the combined envelope can exceed the 16k transport cap. Same bug SHAPE as
// `get_earnings` (#6130) and `get_options_flow` (#6111): a sub-object fit against its own
// standalone budget, merged with sibling fields with no shared accounting. Fixed the same way —
// fit `spx` LAST, against whatever budget remains after everything else already decided.

import { fitSpxStructureForModel } from "@/lib/largo/spx-structure-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

export interface PlatformSnapshotFittedResult {
  spx?: any;
  flows?: any;
  nighthawk?: any;
  largo?: any;
  flows_shown?: number;
  flows_truncated?: boolean;
  members_shown?: number;
  members_truncated?: boolean;
}

export function fitPlatformSnapshotForModel(
  raw: any,
  flowLimitForModel = 20
): { fitted: PlatformSnapshotFittedResult } {
  // Keep core product states but reduce flow array size
  const fitted: PlatformSnapshotFittedResult = {};

  // Small, essentially-fixed-size fields first — `nighthawk` is a tiny digest summary
  // (`NightHawkEditionSummary`) and `largo` is only populated when explicitly requested. These
  // form the base `spx`'s own budget is measured against below, so neither can silently blow the
  // cap without the other knowing.
  if (raw.nighthawk) fitted.nighthawk = raw.nighthawk;
  if (raw.largo) fitted.largo = raw.largo;

  // Reduce flows to top-N items
  if (raw.flows && Array.isArray(raw.flows)) {
    fitted.flows = raw.flows.slice(0, flowLimitForModel);
    fitted.flows_shown = fitted.flows.length;
    fitted.flows_truncated = raw.flows.length > flowLimitForModel;
  }

  // Fit spx LAST, against whatever budget remains after nighthawk/largo/flows are already
  // decided — spx goes through the same structure fitter get_spx_structure uses, since it
  // carries the same fat tail, but now budget-aware of its siblings instead of fit in isolation.
  if (raw.spx) {
    const reserved = JSON.stringify(fitted).length;
    const remaining = Math.max(0, LARGO_RESULT_CHAR_BUDGET - reserved);
    fitted.spx = fitSpxStructureForModel(raw.spx, { budget: remaining }).fitted;
  }

  return { fitted };
}
