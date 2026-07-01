import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

const AV_KEY = process.env.ALPHAVANTAGE_API_KEY?.trim() || "";
const TTL_12H = 12 * 60 * 60 * 1000;

function earningsKeyConfigured(): boolean {
  return AV_KEY.length > 0 && AV_KEY !== "demo";
}

async function loadEarningsCalendar(apiKey: string): Promise<Record<string, string>> {
  const url =
    `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}`);

  const csv   = await res.text();
  const lines = csv.trim().split("\n");
  // CSV header: symbol,name,reportDate,fiscalDateEnding,estimate,currency
  if (lines.length < 2) return {};

  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols   = lines[i].split(",");
    const symbol = cols[0]?.trim().toUpperCase();
    const date   = cols[2]?.trim();
    if (symbol && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // Keep earliest upcoming date per ticker
      if (!out[symbol] || date < out[symbol]) out[symbol] = date;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  if (!earningsKeyConfigured()) {
    const msg = "Earnings calendar unavailable — ALPHAVANTAGE_API_KEY not configured";
    if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
      return NextResponse.json({ earnings: {}, error: msg }, { status: 503 });
    }
    console.warn(`[earnings-calendar] ${msg} — using demo key in dev only`);
  }

  const apiKey = earningsKeyConfigured() ? AV_KEY : "demo";

  try {
    const earnings = await serverCache("earnings-calendar:av:3m", TTL_12H, () =>
      loadEarningsCalendar(apiKey)
    );
    return NextResponse.json({ earnings, configured: earningsKeyConfigured() });
  } catch (err) {
    console.error("[earnings-calendar]", err);
    return NextResponse.json({ earnings: {}, configured: earningsKeyConfigured() });
  }
}
