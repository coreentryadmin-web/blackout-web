import type { FlowRow } from "@/lib/db";
import { sessionFlowSkew } from "@/lib/largo/helix-tape-analytics";
import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_PRINTS = 25;

export type PostgresFlowsFitted = {
  prints: FlowRow[];
  shown: number;
  total: number;
  truncated: boolean;
  pull_skew: ReturnType<typeof sessionFlowSkew>;
};

/** Largo transport fit — skew over the full pull, capped print sample last. */
export function fitPostgresFlowsForModel(raw: FlowRow[]): { fitted: PostgresFlowsFitted } {
  const rows = raw ?? [];
  const pull_skew = sessionFlowSkew(rows);

  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      prints: kept,
      shown: kept.length,
      total,
      truncated: total > kept.length,
      pull_skew: sessionFlowSkew(kept),
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows: MAX_PRINTS }
  );

  const fitted = envelope as PostgresFlowsFitted;
  // Skew is authoritative over the FULL pull the caller requested — not the sample alone.
  fitted.pull_skew = pull_skew;
  return { fitted };
}
