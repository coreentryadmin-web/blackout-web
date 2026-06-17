import { requireTier } from "@/lib/auth-access";
import { Nav } from "@/components/Nav";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { LargoTerminal } from "@/components/desk/LargoTerminal";
import { TradingViewWidget } from "@/components/embeds/TradingViewWidget";

export default async function TerminalPage() {
  await requireTier("premium");

  return (
    <div className="page-shell relative overflow-hidden flex flex-col min-h-screen">
      <Nav />
      <PlatformShell
        variant="largo"
        title="AI Terminal"
        subtitle="Largo — Desk-grade market intelligence"
        deskMode
      >
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7">
            <LargoTerminal />
          </div>
          <div className="xl:col-span-5 space-y-4">
            <TradingViewWidget type="advanced-chart" symbol="AMEX:SPY" title="SPY Context" height={360} />
            <TradingViewWidget type="ticker-tape" title="Tape" height={48} />
          </div>
        </div>
      </PlatformShell>
    </div>
  );
}
