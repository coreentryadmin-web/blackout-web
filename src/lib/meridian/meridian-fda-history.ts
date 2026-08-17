import "server-only";

import { fetchBenzingaCatalysts, fetchBenzingaNews } from "@/lib/providers/polygon";
import { stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { roundFloats } from "@/lib/round-floats";
import type { MeridianFdaPriorDecision } from "@/features/meridian/lib/meridian-types";

function firstYmd(row: Record<string, unknown>): string {
  for (const key of ["date", "decision_date", "pdufa_date", "event_date", "target_date", "due_date"]) {
    const v = String(row[key] ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return "";
}

/** Prior FDA calendar rows + headlines + stock reaction for the same ticker. */
export async function loadMeridianFdaHistory(input: {
  ticker: string;
  beforeYmd: string;
}): Promise<{
  prior_decisions: MeridianFdaPriorDecision[];
  catalysts: Array<{ title: string; channel: string | null; published: string | null }>;
}> {
  const sym = input.ticker.toUpperCase();
  const { serverCache } = await import("@/lib/server-cache");
  const rows = await serverCache("meridian:fda-calendar:all:v1", 30 * 60 * 1000, async () => {
    const { uwConfigured } = await import("@/lib/providers/config");
    if (!uwConfigured()) return [] as Record<string, unknown>[];
    const { fetchUwFdaCalendarAll } = await import("@/lib/providers/unusual-whales");
    return fetchUwFdaCalendarAll(80);
  }).catch(() => [] as Record<string, unknown>[]);

  const priorRows = rows
    .filter((r) => String(r.ticker ?? r.symbol ?? "").toUpperCase() === sym)
    .map((r) => ({
      date: firstYmd(r as Record<string, unknown>),
      drug: String(r.drug ?? r.drug_name ?? r.product ?? "").trim() || null,
      headline: String(r.event ?? r.event_type ?? r.title ?? "").trim() || null,
    }))
    .filter((r) => r.date && r.date < input.beforeYmd)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  const dates = priorRows.map((r) => r.date);
  const [reactions, catalysts, fdaNews] = await Promise.all([
    stockReactionsForDates(sym, dates),
    fetchBenzingaCatalysts(sym, 12).catch(() => []),
    fetchBenzingaNews(10, { ticker: sym, channels: "fda" }).catch(() => []),
  ]);

  const prior_decisions: MeridianFdaPriorDecision[] = priorRows.map((r) => {
    const rx = reactions.get(r.date);
    return {
      date: r.date,
      drug: r.drug,
      headline: r.headline,
      session_change_pct: rx?.session_change_pct ?? null,
      next_day_change_pct: rx?.next_day_change_pct ?? null,
    };
  });

  const headlineMap = new Map<string, { title: string; channel: string | null; published: string | null }>();
  for (const n of fdaNews) {
    const key = n.title.slice(0, 100);
    if (!headlineMap.has(key)) {
      headlineMap.set(key, {
        title: n.title,
        channel: "fda",
        published: n.published || null,
      });
    }
  }
  for (const c of catalysts) {
    const key = c.title.slice(0, 100);
    if (!headlineMap.has(key)) {
      headlineMap.set(key, {
        title: c.title,
        channel: c.channel ?? c.type ?? null,
        published: c.published ?? null,
      });
    }
  }

  return roundFloats({
    prior_decisions,
    catalysts: [...headlineMap.values()].slice(0, 10),
  });
}
