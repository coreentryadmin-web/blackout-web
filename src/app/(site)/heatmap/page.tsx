import type { Metadata } from "next";
import { requireTier } from "@/lib/auth-access";
import { canAccessTool } from "@/lib/tool-access-server";
import { ComingSoon } from "@/components/ComingSoon";
import { ThermalPageShell } from "@/features/thermal/components/ThermalPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("BlackOut Thermal · BlackOut", "/heatmap");

export default async function HeatmapPage() {
  await requireTier("premium");
  if (!(await canAccessTool("heatmap"))) return <ComingSoon toolKey="heatmap" />;

  return <ThermalPageShell />;
}
