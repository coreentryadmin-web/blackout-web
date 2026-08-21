import type { MeridianDimension } from "@/lib/meridian/meridian-viz-core";

/** Earnings detail tabs — mirrors MeridianEarningsTabs. */
export type MeridianEarningsTabId =
  | "summary"
  | "report"
  | "estimates"
  | "positioning"
  | "history";

const DIMENSION_TAB: Record<MeridianDimension, MeridianEarningsTabId> = {
  FLOW: "positioning",
  STRUCTURE: "positioning",
  SENTIMENT: "estimates",
  CATALYST: "estimates",
  HISTORY: "history",
};

/** Where a report dimension's full evidence lives on the earnings desk. */
export function earningsTabForDimension(dim: MeridianDimension): MeridianEarningsTabId {
  return DIMENSION_TAB[dim];
}

export function earningsTabNavLabel(tab: MeridianEarningsTabId): string {
  switch (tab) {
    case "summary":
      return "Summary";
    case "report":
      return "Report";
    case "estimates":
      return "Estimates";
    case "positioning":
      return "Positioning";
    case "history":
      return "History";
  }
}
