import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_EVENTS = 25;

export type SpxVoiceFeedFitted = {
  session_date: string;
  events: Record<string, unknown>[];
  shown: number;
  total: number;
  truncated: boolean;
  note?: string;
};

export function fitSpxVoiceFeedForModel(raw: {
  session_date: string;
  events: Record<string, unknown>[];
  note?: string;
}): { fitted: SpxVoiceFeedFitted } {
  const events = (raw.events ?? []).map((entry) => ({
    ...entry,
    line: typeof entry.line === "string" ? entry.line.slice(0, 240) : entry.line,
  }));

  const { envelope } = fitEnvelopeToBudget(
    events,
    (kept, total) => ({
      session_date: raw.session_date,
      events: kept,
      shown: kept.length,
      total,
      truncated: total > kept.length,
      ...(raw.note ? { note: raw.note } : {}),
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows: MAX_EVENTS }
  );

  return { fitted: envelope as SpxVoiceFeedFitted };
}
