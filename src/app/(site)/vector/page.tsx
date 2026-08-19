import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import {
  VectorPageClient,
  normalizeVectorTicker,
  VECTOR_ORACLE_TICKERS,
} from "@/features/vector";
import { noindexPageMetadata } from "@/lib/page-metadata";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Vector · BlackOut", "/vector");

type PageProps = {
  searchParams: Promise<{ ticker?: string; compare?: string }>;
};

export default async function VectorPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const { ticker: rawTicker, compare: compareRaw } = await searchParams;
  const ticker = normalizeVectorTicker(rawTicker);

  // Client-hydrated seed (VectorPageClient) — same rule as SPX Slayer / SpxVectorEmbed.
  // SSR loadVectorSeedProps blocked HTML 30–90s on cold Polygon reconstruct; navigation
  // soak measured /vector max TTFB ~43s before this change.
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-[60vh] items-center justify-center font-mono text-sm text-cyan-300"
          role="status"
        >
          Loading Vector…
        </div>
      }
    >
      <VectorPageClient
        ticker={ticker}
        initialCompareRaw={compareRaw ?? null}
        defaultDteHorizon={VECTOR_ORACLE_TICKERS.has(ticker) ? "0dte" : "all"}
        defaultChartViewport="session"
      />
    </Suspense>
  );
}
