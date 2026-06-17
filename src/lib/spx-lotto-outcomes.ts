import { dbConfigured } from "@/lib/db";
import { insertLottoPlay, updateLottoPlay } from "@/lib/db";
import type { LottoRecord } from "@/lib/spx-lotto-store";

const memoryIds = new Map<string, number>();

function rowKey(rec: LottoRecord): string {
  return `${rec.session_date}:${rec.pick_count}`;
}

export async function logLottoWatch(rec: LottoRecord): Promise<void> {
  if (!dbConfigured()) return;
  const key = rowKey(rec);
  if (memoryIds.has(key)) return;
  const id = await insertLottoPlay({
    session_date: rec.session_date,
    pick_index: rec.pick_count,
    is_reversal: rec.is_reversal,
    phase: rec.phase,
    direction: rec.direction,
    strike: rec.strike,
    contract_label: rec.contract_label,
    entry_zone: rec.entry_zone,
    target_price: rec.target_price,
    target_pts: rec.target_pts,
    invalidation_level: rec.invalidation_level,
    catalyst_summary: rec.catalyst_summary,
    catalysts: rec.catalysts,
    confidence: rec.confidence,
    headline: rec.headline,
    thesis: rec.thesis,
    picked_at: rec.picked_at,
  });
  if (id != null) memoryIds.set(key, id);
}

export async function logLottoPhase(
  rec: LottoRecord,
  patch: {
    phase: string;
    entry_price?: number | null;
    buy_at?: string | null;
    outcome?: string | null;
    exit_price?: number | null;
    closed_at?: string | null;
  }
): Promise<void> {
  if (!dbConfigured()) return;
  const key = rowKey(rec);
  let id = memoryIds.get(key);
  if (id == null) {
    await logLottoWatch(rec);
    id = memoryIds.get(key);
  }
  if (id == null) return;
  await updateLottoPlay(id, patch);
}
