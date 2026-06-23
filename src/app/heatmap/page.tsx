import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Heatmap } from "@/components/Heatmap";

export default async function HeatmapPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      <Nav />
      <PlatformShell
        variant="heatmap"
        title="THERMAL"
        subtitle="Sector rotation · Institutional movers"
        deskMode
      >
        <Heatmap />
      </PlatformShell>
    </div>
  );
}
