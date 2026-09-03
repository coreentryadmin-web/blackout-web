import type { EcosystemContext } from "@/lib/bie/ecosystem-context";
import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { fitSpxPlayForModel } from "@/lib/largo/spx-play-fit";

const MAX_AUDIT = 5;
const MAX_ANOMALIES = 3;
const MAX_FLOW_PRINTS = 25;

export type EcosystemContextFitted = EcosystemContext & {
  recent_audit_entries_total?: number;
  recent_audit_entries_truncated?: boolean;
  recent_anomalies_total?: number;
  recent_anomalies_truncated?: boolean;
  flow_full_state_fit?: { recent_total: number; recent_shown: number; recent_truncated: boolean };
};

/** Largo transport fit — aggregates first, capped row samples, explicit truncation flags. */
export function fitEcosystemContextForModel(raw: EcosystemContext): { fitted: EcosystemContextFitted } {
  const fitted: EcosystemContextFitted = { ...raw };

  if (raw.recent_audit_entries.length > MAX_AUDIT) {
    fitted.recent_audit_entries = raw.recent_audit_entries.slice(0, MAX_AUDIT);
    fitted.recent_audit_entries_total = raw.recent_audit_entries.length;
    fitted.recent_audit_entries_truncated = true;
  }

  if (raw.recent_anomalies.length > MAX_ANOMALIES) {
    fitted.recent_anomalies = raw.recent_anomalies.slice(0, MAX_ANOMALIES);
    fitted.recent_anomalies_total = raw.recent_anomalies.length;
    fitted.recent_anomalies_truncated = true;
  }

  if (raw.flow_full_state?.recent?.length) {
    const base = { ...raw.flow_full_state };
    delete (base as { recent?: unknown }).recent;
    const rowFit = fitRowsToBudget(base, "recent", raw.flow_full_state.recent, {
      budget: LARGO_RESULT_CHAR_BUDGET,
      maxRows: MAX_FLOW_PRINTS,
    });
    fitted.flow_full_state = { ...raw.flow_full_state, recent: rowFit.kept };
    if (rowFit.total > rowFit.kept.length) {
      fitted.flow_full_state_fit = {
        recent_total: rowFit.total,
        recent_shown: rowFit.kept.length,
        recent_truncated: true,
      };
    }
  }

  if (raw.spx_full_state) {
    fitted.spx_full_state = fitSpxPlayForModel(raw.spx_full_state as Record<string, unknown>).fitted as typeof raw.spx_full_state;
  }

  return { fitted };
}
