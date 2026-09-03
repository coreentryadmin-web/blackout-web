import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function trimSide(side: unknown): unknown {
  if (!side || typeof side !== "object") return side;
  const s = side as Record<string, unknown>;
  return {
    ...s,
    summary: typeof s.summary === "string" ? s.summary.slice(0, 280) : s.summary,
    gamma_regime:
      typeof s.gamma_regime === "string" ? s.gamma_regime.slice(0, 320) : s.gamma_regime,
    conflict_note:
      typeof s.conflict_note === "string" ? s.conflict_note.slice(0, 200) : s.conflict_note,
  };
}

/** Trim prose-heavy compare card fields so the payload stays under transport budget. */
export function fitHelixThermalCompareForModel(raw: Record<string, unknown>): { fitted: Record<string, unknown> } {
  if (raw.kind === "helix_thermal") {
    const fitted = {
      ...raw,
      helix: trimSide(raw.helix),
      thermal: trimSide(raw.thermal),
      conflict_note:
        typeof raw.conflict_note === "string" ? raw.conflict_note.slice(0, 240) : raw.conflict_note,
      regime_interaction:
        raw.regime_interaction && typeof raw.regime_interaction === "object"
          ? {
              ...raw.regime_interaction,
              read:
                typeof (raw.regime_interaction as { read?: unknown }).read === "string"
                  ? (raw.regime_interaction as { read: string }).read.slice(0, 320)
                  : (raw.regime_interaction as { read?: unknown }).read,
            }
          : raw.regime_interaction,
    };
    if (JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET) return { fitted };
    return { fitted };
  }

  if (raw.kind === "peer_tickers" && Array.isArray(raw.rows)) {
    const fitted = {
      ...raw,
      rows: raw.rows.map((row) =>
        row && typeof row === "object"
          ? {
              ...row,
              flow: trimSide((row as { flow?: unknown }).flow),
              gamma: trimSide((row as { gamma?: unknown }).gamma),
              conflict_note:
                typeof (row as { conflict_note?: unknown }).conflict_note === "string"
                  ? (row as { conflict_note: string }).conflict_note.slice(0, 200)
                  : (row as { conflict_note?: unknown }).conflict_note,
            }
          : row
      ),
      peer_divergence_note:
        typeof raw.peer_divergence_note === "string"
          ? raw.peer_divergence_note.slice(0, 240)
          : raw.peer_divergence_note,
    };
    return { fitted };
  }

  return { fitted: raw };
}
