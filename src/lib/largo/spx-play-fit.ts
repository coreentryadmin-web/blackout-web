import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

/** Per-list caps — factors and gate blocks are the usual fat tail on play payloads. */
export const SPX_PLAY_LIST_CAPS: ReadonlyArray<{ key: keyof SpxPlayPayload | string; cap: number }> = [
  { key: "factors", cap: 12 },
];

const size = (o: unknown) => JSON.stringify(o)?.length ?? 0;

export type FitSpxPlayResult<T> = {
  fitted: T & { sample_notes?: Record<string, string> };
  chars: number;
  trimmed: string[];
};

function trimFactorDetail<T extends Record<string, unknown>>(play: T): T {
  const factors = play.factors;
  if (!Array.isArray(factors)) return play;
  return {
    ...play,
    factors: factors.map((f) => {
      const row = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
      const detail = typeof row.detail === "string" ? row.detail.slice(0, 180) : row.detail;
      return { ...row, detail };
    }),
  };
}

/**
 * Fit `get_spx_play` / `spx_full_state` under the Largo transport cap.
 * Scalars and gate verdict survive; factor samples and long prose trim first.
 */
export function fitSpxPlayForModel<T extends Record<string, unknown>>(
  play: T,
  { budget = LARGO_RESULT_CHAR_BUDGET } = {}
): FitSpxPlayResult<T> {
  if (play == null || typeof play !== "object") {
    return { fitted: play as never, chars: size(play), trimmed: [] };
  }

  let out: Record<string, unknown> = trimFactorDetail({ ...play });
  const notes: Record<string, string> = {};
  const trimmed: string[] = [];

  for (const { key, cap } of SPX_PLAY_LIST_CAPS) {
    const value = out[key];
    if (!Array.isArray(value) || value.length <= cap) continue;
    out[key] = value.slice(0, cap);
    notes[String(key)] = `${cap} of ${value.length} factors — SAMPLE kept to fit the model payload cap.`;
    trimmed.push(String(key));
  }

  const gates = out.gates;
  if (gates && typeof gates === "object" && !Array.isArray(gates)) {
    const g = { ...(gates as Record<string, unknown>) };
    const blocks = g.blocks;
    if (Array.isArray(blocks) && blocks.length > 8) {
      g.blocks = blocks.slice(0, 8);
      notes.gates_blocks = `8 of ${blocks.length} gate blocks — SAMPLE kept to fit the model payload cap.`;
      trimmed.push("gates.blocks");
    }
    out = { ...out, gates: g };
  }

  for (const proseKey of ["thesis", "headline"] as const) {
    const v = out[proseKey];
    if (typeof v === "string" && v.length > 320) {
      out[proseKey] = v.slice(0, 320);
      notes[proseKey] = `trimmed from ${v.length} chars to fit the model payload cap`;
      trimmed.push(proseKey);
    }
  }

  if (size(out) > budget) {
    for (const drop of ["playbook_shadow", "desk_context", "telemetry", "mtf", "option_ticket"] as const) {
      if (out[drop] == null) continue;
      out[drop] = null;
      notes[drop] = "omitted to fit the model payload cap";
      trimmed.push(drop);
      if (size(out) <= budget) break;
    }
  }

  if (Object.keys(notes).length > 0) {
    out.sample_notes = notes;
  }

  return { fitted: out as T & { sample_notes?: Record<string, string> }, chars: size(out), trimmed };
}
