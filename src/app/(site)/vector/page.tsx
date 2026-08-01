import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { VectorPageLoader } from "@/features/vector/components/VectorPageLoader";
import { normalizeVectorTicker } from "@/features/vector";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Vector · BlackOut");

type PageProps = {
  searchParams: Promise<{ ticker?: string }>;
};

export default async function VectorPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("vector"))) return <ComingSoon toolKey="vector" />;

  const { ticker: rawTicker } = await searchParams;
  const ticker = normalizeVectorTicker(rawTicker);

  // Client seed fetch (2026-08-01 perf): SSR embedding loadVectorSeedProps bloated /vector to
  // ~50MB (full 20-deep wall ladders × dual rails in the RSC payload). Seed loads via
  // /api/market/vector/seed with transport-trimmed rails; SPX desk embed stays on SpxVectorEmbed.
  return (
    <VectorPageLoader
      ticker={ticker}
      defaultDteHorizon={ticker === "SPX" ? "0dte" : undefined}
      defaultChartViewport="session"
    />
  );
}
