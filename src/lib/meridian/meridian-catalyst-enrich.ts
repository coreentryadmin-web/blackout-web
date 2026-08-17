import "server-only";

import { fetchBenzingaAnalystRatings, fetchBenzingaCatalysts } from "@/lib/providers/polygon";
import { fetchUwCongressTrades, fetchUwInsiderFlow } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import type { MeridianCatalystHeadline } from "@/features/meridian/lib/meridian-types";

export type MeridianAnalystRevision = {
  title: string;
  firm: string | null;
  action: string | null;
  published: string | null;
};

export type MeridianInsiderActivity = {
  title: string;
  published: string | null;
};

export type MeridianCongressActivity = {
  politician: string | null;
  ticker: string | null;
  transaction: string | null;
  published: string | null;
};

export type MeridianCatalystBundle = {
  analyst_revisions: MeridianAnalystRevision[];
  insider_activity: MeridianInsiderActivity[];
  congress_trades: MeridianCongressActivity[];
};

function shapeAnalyst(rows: Array<{ title?: string; published?: string; channels?: string[] }>): MeridianAnalystRevision[] {
  return rows.slice(0, 8).map((r) => {
    const title = String(r.title ?? "").trim();
    const lower = title.toLowerCase();
    let action: string | null = null;
    if (/upgrade|raises|lift/i.test(title)) action = "upgrade";
    else if (/downgrade|cut|lower/i.test(title)) action = "downgrade";
    else if (/initiat/i.test(title)) action = "initiation";
    else if (/price target|pt /i.test(title)) action = "target";
    let firm: string | null = null;
    const m = title.match(/^([^:]+):/);
    if (m?.[1]) firm = m[1].trim();
    return {
      title,
      firm,
      action,
      published: r.published?.trim() || null,
    };
  });
}

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["data", "rows", "results", "transactions", "trades"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

function shapeInsider(rows: Record<string, unknown>[]): MeridianInsiderActivity[] {
  return rows.slice(0, 6).map((r) => ({
    title: String(
      r.description ??
        r.transaction ??
        `${r.insider_name ?? r.name ?? "Insider"} ${r.transaction_type ?? r.type ?? "activity"}`
    ).trim(),
    published: String(r.date ?? r.filing_date ?? r.transaction_date ?? "").slice(0, 10) || null,
  }));
}

function shapeCongress(rows: Record<string, unknown>[]): MeridianCongressActivity[] {
  return rows.slice(0, 6).map((r) => ({
    politician: String(r.politician ?? r.name ?? r.representative ?? "").trim() || null,
    ticker: String(r.ticker ?? r.symbol ?? "").trim().toUpperCase() || null,
    transaction: String(r.transaction ?? r.type ?? r.tx_type ?? "").trim() || null,
    published: String(r.transaction_date ?? r.date ?? r.filed_at ?? "").slice(0, 10) || null,
  }));
}

/** Analyst revisions + insider + congress for earnings/FDA names. */
export async function loadMeridianCatalystBundle(ticker: string): Promise<MeridianCatalystBundle> {
  const sym = ticker.trim().toUpperCase();
  const [analyst, catalysts, insiderRaw, congressRaw] = await Promise.all([
    fetchBenzingaAnalystRatings(sym, 12).catch(() => []),
    fetchBenzingaCatalysts(sym, 8).catch(() => []),
    fetchUwInsiderFlow(sym).catch(() => null),
    fetchUwCongressTrades(sym, 12).catch(() => null),
  ]);

  const insiderRows = extractRows(insiderRaw);
  const congressRows = extractRows(congressRaw);

  const insiderFromBenzinga: MeridianInsiderActivity[] = catalysts
    .filter((c) => c.type === "insider")
    .map((c) => ({ title: c.title, published: c.published || null }));

  return roundFloats({
    analyst_revisions: shapeAnalyst(analyst),
    insider_activity: [
      ...insiderFromBenzinga,
      ...shapeInsider(insiderRows),
    ].slice(0, 8),
    congress_trades: shapeCongress(congressRows),
  });
}

export function catalystHeadlinesFromBundle(
  bundle: MeridianCatalystBundle
): MeridianCatalystHeadline[] {
  return bundle.analyst_revisions.slice(0, 4).map((r) => ({
    title: r.title,
    channel: r.action ? `analyst ${r.action}` : "analyst",
    published: r.published,
  }));
}
