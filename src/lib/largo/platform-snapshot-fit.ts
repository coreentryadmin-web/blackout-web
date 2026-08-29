// Fitting for get_platform_snapshot Largo transport cap.
// Cross-product platform state exceeds 16k cap. Reduce flow limit and active session
// count for Largo; product consumers (UI, Night Hawk, etc.) use full data directly.

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

  // Copy core product states (spx, nighthawk, largo)
  if (raw.spx) fitted.spx = raw.spx;
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
