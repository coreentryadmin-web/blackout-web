import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_ROWS = 15;

export type HelixSignalOutcomesFitted = Record<string, unknown> & {
  rows_shown: number;
  rows_summarized: number;
  rows_truncated: boolean;
};

/** Largo transport fit — summary aggregates over the full fetch; capped row sample last. */
export function fitHelixSignalOutcomesForModel(raw: Record<string, unknown>): { fitted: HelixSignalOutcomesFitted } {
  if (raw.available === false) return { fitted: raw as HelixSignalOutcomesFitted };

  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const summarized = typeof raw.rows_summarized === "number" ? raw.rows_summarized : rows.length;
  const { summary, outcome_values, ...rest } = raw;

  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      ...rest,
      summary,
      outcome_values,
      rows: kept,
      rows_shown: kept.length,
      rows_summarized: Math.max(summarized, total),
      rows_truncated: total > kept.length,
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows: MAX_ROWS }
  );

  return { fitted: envelope as HelixSignalOutcomesFitted };
}
