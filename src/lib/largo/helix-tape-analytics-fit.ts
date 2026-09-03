import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_LEADERS = 8;
const MAX_ROUTES = 10;
const MAX_EXPIRIES = 6;

export type HelixTapeAnalyticsFitted = Record<string, unknown> & {
  net_premium_leaders_total?: number;
  net_premium_leaders_truncated?: boolean;
  route_breakdown_total?: number;
  route_breakdown_truncated?: boolean;
};

/**
 * Largo transport fit for get_helix_tape_analytics — session/window aggregates first,
 * capped leaderboard/route/expiry samples with explicit truncation flags.
 */
export function fitHelixTapeAnalyticsForModel(
  raw: Record<string, unknown>
): { fitted: HelixTapeAnalyticsFitted } {
  if (raw.available === false) return { fitted: raw };

  const {
    net_premium_leaders,
    route_breakdown,
    expiry_concentration,
    expiry_concentration_total_expiries,
    expiry_concentration_truncated,
    ...rest
  } = raw;

  let fitted: HelixTapeAnalyticsFitted = { ...rest };

  if (Array.isArray(net_premium_leaders) && net_premium_leaders.length) {
    const rowFit = fitRowsToBudget(fitted, "net_premium_leaders", net_premium_leaders, {
      budget: LARGO_RESULT_CHAR_BUDGET,
      maxRows: MAX_LEADERS,
    });
    fitted = { ...fitted, net_premium_leaders: rowFit.kept };
    if (rowFit.total > rowFit.kept.length) {
      fitted.net_premium_leaders_total = rowFit.total;
      fitted.net_premium_leaders_truncated = true;
    }
  }

  if (Array.isArray(route_breakdown) && route_breakdown.length) {
    const rowFit = fitRowsToBudget(fitted, "route_breakdown", route_breakdown, {
      budget: LARGO_RESULT_CHAR_BUDGET,
      maxRows: MAX_ROUTES,
    });
    fitted = { ...fitted, route_breakdown: rowFit.kept };
    if (rowFit.total > rowFit.kept.length) {
      fitted.route_breakdown_total = rowFit.total;
      fitted.route_breakdown_truncated = true;
    }
  }

  if (Array.isArray(expiry_concentration) && expiry_concentration.length) {
    const rowFit = fitRowsToBudget(fitted, "expiry_concentration", expiry_concentration, {
      budget: LARGO_RESULT_CHAR_BUDGET,
      maxRows: MAX_EXPIRIES,
    });
    fitted = {
      ...fitted,
      expiry_concentration: rowFit.kept,
      expiry_concentration_total_expiries:
        typeof expiry_concentration_total_expiries === "number"
          ? expiry_concentration_total_expiries
          : rowFit.total,
      expiry_concentration_truncated:
        Boolean(expiry_concentration_truncated) || rowFit.total > rowFit.kept.length,
    };
  }

  return { fitted };
}
