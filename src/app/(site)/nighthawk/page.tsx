import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { NighthawkPageShell } from "@/features/nighthawk/components/NighthawkPageShell";
import { parseNightHawkView } from "@/features/nighthawk/lib/nighthawk-view";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Night Hawk · BlackOut", "/nighthawk");

type PageProps = {
  searchParams: Promise<{ view?: string }>;
};

export default async function NightHawkPage({ searchParams }: PageProps) {
  await requireTier("premium");
  if (!(await canAccessTool("nighthawk"))) return <ComingSoon toolKey="nighthawk" />;

  const { view } = await searchParams;
  // Client SWR loads /api/market/zerodte/board — skip SSR getZeroDteBoardPayload() so HTML
  // is not blocked on a cold board rebuild (same class of ~30–60s TTFB as dashboard Vector SSR).
  const seed = { view: parseNightHawkView(view ?? null), board: null };

  return <NighthawkPageShell seed={seed} />;
}
