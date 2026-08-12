import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import {
  VectorPageShell,
  loadVectorSeedProps,
  normalizeVectorTicker,
  VECTOR_ORACLE_TICKERS,
} from "@/features/vector";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Vector · BlackOut", "/vector");

type PageProps = {
  searchParams: Promise<{ ticker?: string }>;
};

export default async function VectorPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const { ticker: rawTicker } = await searchParams;
  const ticker = normalizeVectorTicker(rawTicker);

  // Shared seed loader (2026-07-13, member-directed desk consolidation): the SPX Slayer dashboard
  // embeds this same Vector surface, so ALL seed logic (bars, wall scope, observed-rail merge,
  // modeled-prefix backfill, empty-case seeding) lives in loadVectorSeedProps — one code path for
  // both routes, zero drift. Preload the 0DTE recorded rail so the first paint shows the full
  // intraday bead trail when the member opens 0DTE (SPX Slayer + /vector SPX).
  const seed = await loadVectorSeedProps(ticker, {
    seedDteHorizon: VECTOR_ORACLE_TICKERS.has(ticker) ? "0dte" : undefined,
  });

  return (
    <VectorPageShell
      {...seed}
      defaultDteHorizon={VECTOR_ORACLE_TICKERS.has(ticker) ? "0dte" : undefined}
      defaultChartViewport="session"
    />
  );
}
