import { fetchPlaybookShadowObservationsForSession } from "@/lib/db";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

type ShadowVerdict = {
  playbook_id?: string;
  trigger_fired?: boolean;
  precondition_match?: boolean;
  primary?: boolean;
  detail?: string;
};

function summarizeVerdicts(verdicts: unknown): Array<{
  playbook_id: string;
  trigger_fired: boolean;
  precondition_match: boolean;
  primary: boolean;
  detail: string | null;
}> {
  if (!Array.isArray(verdicts)) return [];
  return verdicts
    .filter((v): v is ShadowVerdict => v != null && typeof v === "object")
    .map((v) => ({
      playbook_id: String(v.playbook_id ?? "unknown"),
      trigger_fired: Boolean(v.trigger_fired),
      precondition_match: Boolean(v.precondition_match),
      primary: Boolean(v.primary),
      detail: v.detail != null ? String(v.detail) : null,
    }));
}

export async function spxPlaybookShadowHistoryForLargo(opts?: {
  session_date?: string;
  limit?: number;
}) {
  const sessionDate = opts?.session_date?.trim() || todayEtYmd();
  const limit = Math.min(200, Math.max(1, Number(opts?.limit ?? 50) || 50));
  const rows = await fetchPlaybookShadowObservationsForSession(sessionDate, limit);

  return {
    available: true,
    as_of: new Date().toISOString(),
    as_of_et: etStamp(Date.now()),
    session_date: sessionDate,
    count: rows.length,
    observations: rows.map((row) => ({
      id: row.id,
      observed_at: row.observed_at,
      primary_playbook_id: row.primary_playbook_id,
      regime: row.regime,
      gamma_regime: row.gamma_regime,
      price_at_observation: row.price_at_observation,
      engine_action: row.engine_action,
      engine_score: row.engine_score,
      verdicts: summarizeVerdicts(row.verdicts),
    })),
    note:
      rows.length === 0
        ? "No playbook shadow observations logged yet for this session — rows appear on meaningful matcher state transitions."
        : "Shadow-mode evidence only — these are what the named playbooks WOULD have flagged, not committed Slayer trades.",
  };
}
