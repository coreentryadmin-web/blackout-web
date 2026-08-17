import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { serverCache } from "@/lib/server-cache";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { loadCurrentChainContracts } from "@/features/vector/lib/vector-gex-reconstruct-server";
import { deriveExpectedMoveInputsForEarningsDate } from "@/features/vector/lib/vector-expected-move-atm";
import { computeExpectedMove, type ExpectedMove } from "@/features/vector/lib/vector-expected-move";

const EM_CACHE_MS = 10 * 60 * 1000;
const BATCH_CAP = 36;

export type EarningsExpectedMove = ExpectedMove & { expiry: string };

/**
 * Options-implied expected move for an earnings print — expiry bracketing the report date,
 * ATM IV from the live Polygon chain. Best-effort null when chain/spot unavailable.
 */
export async function loadEarningsExpectedMove(
  ticker: string,
  earningsDateYmd: string | null
): Promise<EarningsExpectedMove | null> {
  const sym = normalizeVectorTicker(ticker);
  const dateKey = earningsDateYmd?.slice(0, 10) ?? "next";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey !== "next") return null;

  return serverCache(`meridian:earnings-em:v2:${sym}:${dateKey}`, EM_CACHE_MS, async () => {
    try {
      const pos = await getGexPositioning(sym);
      const spot = pos?.spot;
      if (!(spot && spot > 0)) return null;

      const contracts = await loadCurrentChainContracts(sym, spot);
      if (!contracts.length) return null;

      const reportYmd = dateKey === "next" ? todayEtYmd() : dateKey;
      const inputs = deriveExpectedMoveInputsForEarningsDate(
        contracts,
        spot,
        reportYmd,
        todayEtYmd()
      );
      if (!inputs) return null;

      const em = computeExpectedMove({
        spot: inputs.spot,
        atmIv: inputs.atmIv,
        dteDays: inputs.dteDays,
      });
      if (!em) return null;
      return { ...em, expiry: inputs.expiry };
    } catch {
      return null;
    }
  }).catch(() => null);
}

/** Headline expected-move percent for desk chips (e.g. 8.2). */
export async function loadEarningsExpectedMovePct(
  ticker: string,
  earningsDateYmd: string | null
): Promise<number | null> {
  const em = await loadEarningsExpectedMove(ticker, earningsDateYmd);
  if (em?.movePct == null) return null;
  return Number((em.movePct * 100).toFixed(1));
}

/** Batch chain-IV expected moves for timeline rows — one upstream pull per ticker (cached). */
export async function batchLoadEarningsExpectedMovePct(
  items: Array<{ ticker: string; report_date: string }>
): Promise<Map<string, number | null>> {
  const byTicker = new Map<string, string>();
  for (const row of items) {
    const t = row.ticker.trim().toUpperCase();
    const d = row.report_date?.slice(0, 10);
    if (!t || !d) continue;
    if (!byTicker.has(t)) byTicker.set(t, d);
  }

  const out = new Map<string, number | null>();
  const entries = [...byTicker.entries()].slice(0, BATCH_CAP);
  await Promise.all(
    entries.map(async ([ticker, report_date]) => {
      const pct = await loadEarningsExpectedMovePct(ticker, report_date);
      out.set(ticker, pct);
    })
  );
  return out;
}
