import type { SpxEngineSnapshotRow } from "@/features/spx/lib/spx-signal-log";
import { fitEnvelopeToBudget, LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

const MAX_SNAPSHOTS = 15;

function trimSnapshot(row: SpxEngineSnapshotRow): SpxEngineSnapshotRow {
  const blocks = Array.isArray(row.gates_blocks)
    ? row.gates_blocks.map((b) => String(b).slice(0, 120))
    : row.gates_blocks;
  return {
    ...row,
    thesis: row.thesis ? String(row.thesis).slice(0, 200) : row.thesis,
    gates_blocks: blocks,
  };
}

export type SpxEngineSnapshotsFitted = {
  snapshots: SpxEngineSnapshotRow[];
  shown: number;
  total: number;
  truncated: boolean;
};

/** Largo transport fit — newest-first history with explicit truncation flags. */
export function fitSpxEngineSnapshotsForModel(
  raw: SpxEngineSnapshotRow[],
  requestedLimit = 20
): { fitted: SpxEngineSnapshotsFitted } {
  const rows = (raw ?? []).map(trimSnapshot);
  const maxRows = Math.min(requestedLimit, MAX_SNAPSHOTS);

  const { envelope } = fitEnvelopeToBudget(
    rows,
    (kept, total) => ({
      snapshots: kept,
      shown: kept.length,
      total,
      truncated: total > kept.length,
    }),
    { budget: LARGO_RESULT_CHAR_BUDGET, maxRows }
  );

  return { fitted: envelope as SpxEngineSnapshotsFitted };
}
