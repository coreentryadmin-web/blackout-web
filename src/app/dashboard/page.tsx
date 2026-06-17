import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { SpxDashboard } from "@/components/SpxDashboard";

export const revalidate = 0;

export default async function DashboardPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden">
      <Nav />
      <PlatformShell
        variant="dashboard"
        title="SPX Dashboard"
        subtitle="GEX · VWAP · Regime · Dealer positioning"
        deskMode
      >
        <SpxDashboard />
      </PlatformShell>
    </div>
  );
}
