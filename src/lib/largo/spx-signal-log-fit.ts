import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_ROWS = 15;

export type SpxSignalLogFitted = {
  signals: Record<string, unknown>[];
  shown: number;
  total: number;
  truncated: boolean;
};

export function fitSpxSignalLogForModel(raw: Record<string, unknown>[]): { fitted: SpxSignalLogFitted } {
  const rows = (raw ?? []).map((row) => ({
    ...row,
    thesis: typeof row.thesis === "string" ? row.thesis.slice(0, 200) : row.thesis,
    headline: typeof row.headline === "string" ? row.headline.slice(0, 160) : row.headline,
  }));

  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      signals: kept,
      shown: kept.length,
      total,
      truncated: total > kept.length,
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows: MAX_ROWS }
  );

  return { fitted: envelope as SpxSignalLogFitted };
}
