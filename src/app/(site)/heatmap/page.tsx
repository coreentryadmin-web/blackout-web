import type { Metadata } from "next";
import { ThermalPageShell } from "@/features/thermal/components/ThermalPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("BlackOut Thermal · BlackOut", "/heatmap");

export default function HeatmapPage() {
  return <ThermalPageShell />;
}
