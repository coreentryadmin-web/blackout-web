import "server-only";

import {
  fetchBenzingaCatalysts,
  fetchBenzingaNews,
  parsePriceTargetFromText,
} from "@/lib/providers/polygon";
import { fetchUwCongressTrades, fetchUwInsiderFlow } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import { buildStreetSkewFromPriceTargets } from "@/lib/meridian/meridian-benzinga-analytics";
import type {
  MeridianCatalystBrief,
  MeridianCatalystHeadline,
  MeridianPriceTargetRow,
  MeridianStreetSkew,
} from "@/features/meridian/lib/meridian-types";
import { meridianFeedText } from "@/lib/meridian/meridian-feed-text";
import { shapeCatalystBriefs } from "@/lib/meridian/meridian-catalyst-enrich-core";

export type MeridianAnalystRevision = {
  title: string;
  firm: string | null;
  action: string | null;
  published: string | null;
};

export type MeridianInsiderActivity = {
  title: string;
  published: string | null;
  source?: "benzinga" | "uw" | null;
};

export type MeridianCongressActivity = {
  politician: string | null;
  ticker: string | null;
  transaction: string | null;
  published: string | null;
};

export type MeridianCatalystBundle = {
  analyst_revisions: MeridianAnalystRevision[];
  price_targets: MeridianPriceTargetRow[];
  street_skew: MeridianStreetSkew | null;
  catalyst_briefs: MeridianCatalystBrief[];
  insider_activity: MeridianInsiderActivity[];
  congress_trades: MeridianCongressActivity[];
};


const ANALYST_CHANNELS =
  "analyst ratings,price target,upgrades,downgrades,analyst color";

function shapeAnalyst(rows: Array<{ title?: string; published?: string; channels?: string[] }>): MeridianAnalystRevision[] {
  return rows.slice(0, 10).map((r) => {
    // DECODE BEFORE PARSING. `firm` is sliced out of this string below and the action keywords are
    // matched against it, so an encoded title puts entities inside a derived value.
    const title = meridianFeedText(r.title);
    let action: string | null = null;
    if (/upgrade|raises|lift/i.test(title)) action = "upgrade";
    else if (/downgrade|cut|lower/i.test(title)) action = "downgrade";
    else if (/initiat/i.test(title)) action = "initiation";
    else if (/price target|pt /i.test(title)) action = "target";
    else if (/reiterat|maintain|affirm/i.test(title)) action = "reiterate";
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

async function loadPriceTargetRows(ticker: string): Promise<MeridianPriceTargetRow[]> {
  const sym = ticker.toUpperCase();
  try {
    const articles = await fetchBenzingaNews(12, { ticker: sym, channels: "price target" });
    const out: MeridianPriceTargetRow[] = [];
    for (const a of articles) {
      // Decoded before `parsePriceTargetFromText` reads it — a numeric entity can hide a character
      // the parser is looking for, and the parsed value is a NUMBER shown to a member.
      const text = meridianFeedText(`${a.title ?? ""} ${a.teaser ?? ""} ${a.body ?? ""}`);
      const parsed = parsePriceTargetFromText(text);
      if (!parsed) continue;
      out.push({
        price_target: parsed.value,
        firm: parsed.firm,
        action: parsed.action,
        summary: meridianFeedText(a.title || a.teaser || "").slice(0, 200),
        published: a.published || null,
      });
      if (out.length >= 6) break;
    }
    return out;
  } catch {
    return [];
  }
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
    source: "uw" as const,
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

function dedupeInsider(rows: MeridianInsiderActivity[]): MeridianInsiderActivity[] {
  const seen = new Set<string>();
  const out: MeridianInsiderActivity[] = [];
  for (const row of rows) {
    const key = row.title.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.slice(0, 8);
}

/** Analyst + price targets + catalyst briefs + merged insider/congress. */
export async function loadMeridianCatalystBundle(ticker: string): Promise<MeridianCatalystBundle> {
  const sym = ticker.trim().toUpperCase();
  const [analystNews, catalysts, price_targets, insiderRaw, congressRaw] = await Promise.all([
    fetchBenzingaNews(14, { ticker: sym, channels: ANALYST_CHANNELS }).catch(() => []),
    fetchBenzingaCatalysts(sym, 10).catch(() => []),
    loadPriceTargetRows(sym),
    fetchUwInsiderFlow(sym).catch(() => null),
    fetchUwCongressTrades(sym, 12).catch(() => null),
  ]);

  const insiderRows = extractRows(insiderRaw);
  const congressRows = extractRows(congressRaw);

  const insiderFromBenzinga: MeridianInsiderActivity[] = catalysts
    .filter((c) => c.type === "insider")
    .map((c) => ({ title: c.title, published: c.published || null, source: "benzinga" as const }));

  const ptForSkew = price_targets.map((p) => ({
    price_target: p.price_target,
    firm: p.firm,
    action: p.action as "raised" | "lowered" | "initiated" | "reiterated" | "maintained" | "set" | null,
    summary: p.summary,
    published: p.published ?? "",
    url: "",
  }));

  return roundFloats({
    analyst_revisions: shapeAnalyst(analystNews),
    price_targets,
    street_skew: buildStreetSkewFromPriceTargets(ptForSkew),
    catalyst_briefs: shapeCatalystBriefs(catalysts),
    insider_activity: dedupeInsider([...insiderFromBenzinga, ...shapeInsider(insiderRows)]),
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
