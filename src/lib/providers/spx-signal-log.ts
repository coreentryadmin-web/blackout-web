import { dbConfigured, ensureSchema, fetchRecentSpxSignalLogs, getMeta, insertSpxSignalLog, setMeta } from "@/lib/db";
import type { SpxDeskPayload } from "./spx-desk";
import { computeSpxTradeSignal } from "@/lib/spx-signals";

const CURSOR_KEY = "spx_signal_log_cursor";

export type SpxSignalLogRow = {
  id: number;
  signal_key: string;
  action: string;
  bias: string;
  score: number;
  confidence: number;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  headline: string;
  factors: unknown;
  created_at: string;
};

function signalKey(s: ReturnType<typeof computeSpxTradeSignal>): string {
  if (!s) return "";
  return `${s.action}|${s.confidence}|${Math.round(s.score)}|${s.headline}`;
}

export async function maybeLogSpxSignal(desk: SpxDeskPayload): Promise<void> {
  if (!dbConfigured() || !desk.market_open) return;

  const signal = computeSpxTradeSignal(desk);
  if (!signal) return;

  const key = signalKey(signal);
  const prev = await getMeta(CURSOR_KEY);
  if (prev === key) return;

  await ensureSchema();
  await insertSpxSignalLog({
    signal_key: key,
    action: signal.action,
    bias: signal.bias,
    score: signal.score,
    confidence: signal.confidence,
    price: desk.price,
    entry: signal.levels.entry,
    stop: signal.levels.stop,
    target: signal.levels.target,
    headline: signal.headline,
    factors: signal.factors,
  });
  await setMeta(CURSOR_KEY, key);
}

export async function fetchRecentSpxSignals(limit = 50): Promise<SpxSignalLogRow[]> {
  if (!dbConfigured()) return [];
  return fetchRecentSpxSignalLogs(limit);
}
