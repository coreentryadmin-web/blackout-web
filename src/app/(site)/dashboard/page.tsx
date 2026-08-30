import type { Metadata } from "next";
import { canAccessTool } from "@/lib/tool-access-server";
import { SpxDashboard } from "@/features/spx";
import { DeskShell } from "@/components/layout/DeskShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = noindexPageMetadata("SPX Slayer · BlackOut", "/dashboard");

export default async function DashboardPage() {
  // Vector chart is client-hydrated (SpxVectorEmbed) — no SSR vector seed on this route.
  // Cold Polygon reconstruct can block HTML for 30–90s; /vector keeps full SSR seed.
  const vectorEnabled = await canAccessTool("vector");

  return (
    <DeskShell fullBleed className="ios-native-page ios-native-page-spx">
      <SpxDashboard vectorEnabled={vectorEnabled} />
    </DeskShell>
  );
}
