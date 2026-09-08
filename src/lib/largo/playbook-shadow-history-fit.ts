import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

const MAX_OBSERVATIONS = 20;

export type PlaybookShadowHistoryFitted = {
  available: true;
  as_of: string;
  as_of_et: string | null;
  session_date: string;
  observations: Record<string, unknown>[];
  shown: number;
  total: number;
  truncated: boolean;
  note: string;
};

export function fitPlaybookShadowHistoryForModel(raw: {
  session_date: string;
  observations: Record<string, unknown>[];
  note?: string;
}): { fitted: PlaybookShadowHistoryFitted } {
  const observations = (raw.observations ?? []).map((row) => ({
    ...row,
    verdicts: Array.isArray(row.verdicts)
      ? row.verdicts.slice(0, 8).map((v) =>
          v && typeof v === "object"
            ? {
                ...v,
                detail:
                  typeof (v as { detail?: unknown }).detail === "string"
                    ? (v as { detail: string }).detail.slice(0, 160)
                    : (v as { detail?: unknown }).detail,
              }
            : v
        )
      : row.verdicts,
  }));

  const { envelope } = fitEnvelopeToBudget(
    observations,
    (kept, total) => ({
      available: true as const,
      as_of: new Date().toISOString(),
      as_of_et: etStamp(Date.now()),
      session_date: raw.session_date,
      observations: kept,
      shown: kept.length,
      total,
      truncated: total > kept.length,
      note:
        raw.note ??
        "Shadow-mode evidence only — these are what the named playbooks WOULD have flagged, not committed Slayer trades.",
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows: MAX_OBSERVATIONS }
  );

  return { fitted: envelope as PlaybookShadowHistoryFitted };
}
