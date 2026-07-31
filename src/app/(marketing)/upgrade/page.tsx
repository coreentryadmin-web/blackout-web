import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { UpgradePageShell } from "@/components/upgrade/UpgradePageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";
// /upgrade now lives in the (marketing) group and wears the marketing chrome
// (was the authenticated app shell). Import the app component styles it still
// relies on — `.content-rail`, `.page-shell`, `.upgrade-*` live in globals.css,
// which the lean (marketing) layout does not load. Scoped to this route subtree.
import "../../globals.css";

export const metadata: Metadata = noindexPageMetadata("Upgrade · BlackOut");

export default function UpgradePage() {
  return (
    <MarketingPageShell showChart={false}>
      {/* Clear the fixed marketing nav; the marketing chrome owns the frame, so
          UpgradePageShell renders frameless (no inner PageShell / duplicate main). */}
      <div style={{ paddingTop: "var(--nav-offset)" }}>
        <UpgradePageShell frame={false} />
      </div>
    </MarketingPageShell>
  );
}
