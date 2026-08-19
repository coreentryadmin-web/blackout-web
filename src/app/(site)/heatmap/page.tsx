import type { Metadata } from "next";
import { requireDeskTool } from "@/lib/auth-access";
import { ComingSoon } from "@/components/ComingSoon";
import { ThermalPageShell } from "@/features/thermal/components/ThermalPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("BlackOut Thermal · BlackOut", "/heatmap");

export default async function HeatmapPage() {
  if (!(await requireDeskTool("premium", "heatmap"))) return <ComingSoon toolKey="heatmap" />;

  return <ThermalPageShell />;
}
