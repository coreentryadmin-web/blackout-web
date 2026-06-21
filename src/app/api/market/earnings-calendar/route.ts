import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { serverCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

const AV_KEY  = process.env.ALPHAVANTAGE_API_KEY ?? "demo";
const TTL_12H = 12 * 60 * 60 * 1000;

async function loadEarningsCalendar(): Promise<Record<string, string>> {
  const url =
    `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${AV_KEY}`;
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

  try {
    const earnings = await serverCache("earnings-calendar:av:3m", TTL_12H, loadEarningsCalendar);
    return NextResponse.json({ earnings });
  } catch (err) {
    console.error("[earnings-calendar]", err);
    return NextResponse.json({ earnings: {} });
  }
}
