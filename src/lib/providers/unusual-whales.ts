import { uwConfigured } from "./config";

const BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const KEY = process.env.UW_API_KEY ?? "";

async function uwGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!uwConfigured()) throw new Error("UW_API_KEY not set");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Unusual Whales ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "flow_alerts", "alerts"]) {
      const block = obj[key];
      if (Array.isArray(block)) return block as Record<string, unknown>[];
    }
  }
  return [];
}

export type MarketFlowAlert = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
};

function rowToFlow(row: Record<string, unknown>): MarketFlowAlert {
  const opt = String(row.type ?? row.option_type ?? "call").toLowerCase();
  const premium = Number(row.total_premium ?? row.premium ?? 0);
  const dte = row.expiry ? Math.ceil((new Date(String(row.expiry)).getTime() - Date.now()) / 86400000) : 99;
  const route = premium >= 1_000_000 ? "whale" : dte <= 0 ? "0dte" : "stock";

  let alertedAt = String(row.created_at ?? "");
  if (!alertedAt && row.start_time) {
    const ts = Number(row.start_time);
    alertedAt = new Date(ts > 1e12 ? ts : ts * 1000).toISOString();
  }

  return {
    ticker: String(row.ticker ?? "").toUpperCase(),
    premium,
    option_type: opt.startsWith("p") ? "PUT" : "CALL",
    expiry: String(row.expiry ?? "").slice(0, 10),
    strike: Number(row.strike ?? 0),
    direction: opt.startsWith("p") ? "bearish" : "bullish",
    score: Number(row.score ?? 0),
    route,
    alerted_at: alertedAt || new Date().toISOString(),
  };
}

export async function fetchMarketFlowAlerts(params?: {
  limit?: number;
  ticker?: string;
  min_premium?: number;
}): Promise<MarketFlowAlert[]> {
  const query: Record<string, string | number> = {
    limit: Math.min(params?.limit ?? 50, 200),
  };
  if (params?.ticker) query.ticker_symbol = params.ticker.toUpperCase();
  if (params?.min_premium) query.min_premium = params.min_premium;

  const data = await uwGet<unknown>("/api/option-trades/flow-alerts", query);
  return extractRows(data).map(rowToFlow);
}
