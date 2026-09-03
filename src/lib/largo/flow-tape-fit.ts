import type { FlowTapeSummary } from "@/lib/platform/types";
import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_RECENT = 25;

export type FlowTapeFitted = FlowTapeSummary & {
  recent_total?: number;
  recent_truncated?: boolean;
};

/** Largo transport fit — aggregates and skew first; capped recent print sample last. */
export function fitFlowTapeForModel(raw: FlowTapeSummary): { fitted: FlowTapeFitted } {
  if (!raw.recent?.length) return { fitted: raw };

  const base: Omit<FlowTapeSummary, "recent"> = {
    count: raw.count,
    total_premium: raw.total_premium,
    top_tickers: raw.top_tickers,
    strike_stacks: raw.strike_stacks,
    window_hours: raw.window_hours,
    pull_skew: raw.pull_skew,
  };

  const rowFit = fitRowsToBudget(base, "recent", raw.recent, {
    budget: LARGO_RESULT_CHAR_BUDGET,
    maxRows: MAX_RECENT,
  });

  const fitted: FlowTapeFitted = { ...raw, recent: rowFit.kept };
  if (rowFit.total > rowFit.kept.length) {
    fitted.recent_total = rowFit.total;
    fitted.recent_truncated = true;
  }
  return { fitted };
}
