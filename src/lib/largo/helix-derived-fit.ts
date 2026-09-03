import { fitRowsToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const PANEL_CAPS = {
  stacked_hits: 10,
  top_prints: 6,
  velocity_spikes: 6,
  split_flow: 6,
} as const;

type PanelKey = keyof typeof PANEL_CAPS;

const PANEL_TOTAL_KEYS: Record<PanelKey, string> = {
  stacked_hits: "stacked_hits_total",
  top_prints: "top_prints_total",
  velocity_spikes: "velocity_spikes_total",
  split_flow: "split_flow_total",
};

const PANEL_TRUNC_KEYS: Record<PanelKey, string> = {
  stacked_hits: "stacked_hits_truncated",
  top_prints: "top_prints_truncated",
  velocity_spikes: "velocity_spikes_truncated",
  split_flow: "split_flow_truncated",
};

/**
 * Second-pass Largo transport fit for get_helix_derived — product-reads already caps each panel,
 * but heavy position_intent / detail strings can still exceed the transport budget.
 */
export function fitHelixDerivedForModel(raw: Record<string, unknown>): { fitted: Record<string, unknown> } {
  if (raw.available === false) return { fitted: raw };

  let fitted: Record<string, unknown> = { ...raw };

  for (const key of Object.keys(PANEL_CAPS) as PanelKey[]) {
    const rows = fitted[key];
    if (!Array.isArray(rows) || !rows.length) continue;
    const trimmed = rows.map((row) =>
      row && typeof row === "object"
        ? {
            ...row,
            detail:
              typeof (row as { detail?: unknown }).detail === "string"
                ? (row as { detail: string }).detail.slice(0, 160)
                : (row as { detail?: unknown }).detail,
          }
        : row
    );
    const rowFit = fitRowsToBudget(fitted, key, trimmed, {
      budget: LARGO_RESULT_CHAR_BUDGET,
      maxRows: PANEL_CAPS[key],
    });
    fitted = { ...fitted, [key]: rowFit.kept };
    const totalKey = PANEL_TOTAL_KEYS[key];
    const truncKey = PANEL_TRUNC_KEYS[key];
    const priorTotal = typeof fitted[totalKey] === "number" ? Number(fitted[totalKey]) : rowFit.total;
    fitted[totalKey] = Math.max(priorTotal, rowFit.total);
    fitted[truncKey] = Boolean(fitted[truncKey]) || rowFit.total > rowFit.kept.length;
  }

  return { fitted };
}
