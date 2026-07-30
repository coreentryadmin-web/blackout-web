import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { SpxDashboard } from "@/features/spx";
import { DeskShell } from "@/components/layout/DeskShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "SPX Slayer · BlackOut",
  description: "Live SPX structure — GEX walls, dealer positioning, and session levels.",
};

export default async function DashboardPage() {
  await requireTier("community");

  // Vector chart is client-hydrated (SpxVectorEmbed) — no SSR vector seed on this route.
  // Cold Polygon reconstruct can block HTML for 30–90s; /vector keeps full SSR seed.
  const vectorEnabled = await canAccessTool("vector");

  return (
    <DeskShell fullBleed className="ios-native-page ios-native-page-spx">
      <SpxDashboard vectorEnabled={vectorEnabled} />
    </DeskShell>
  );
}
