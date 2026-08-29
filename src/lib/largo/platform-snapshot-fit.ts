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

import { fitSpxStructureForModel } from "@/lib/largo/spx-structure-fit";

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

  // Copy core product states (spx, nighthawk, largo) — spx goes through the same
  // structure fitter get_spx_structure uses, since it carries the same fat tail.
  if (raw.spx) fitted.spx = fitSpxStructureForModel(raw.spx).fitted;
  if (raw.nighthawk) fitted.nighthawk = raw.nighthawk;
  if (raw.largo) fitted.largo = raw.largo;

  // Reduce flows to top-N items
  if (raw.flows && Array.isArray(raw.flows)) {
    fitted.flows = raw.flows.slice(0, flowLimitForModel);
    fitted.flows_shown = fitted.flows.length;
    fitted.flows_truncated = raw.flows.length > flowLimitForModel;
  }

  return { fitted };
}
