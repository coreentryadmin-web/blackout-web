import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingClerkBridge } from "@/components/marketing/MarketingClerkBridge";
import { UpgradePageShell } from "@/components/upgrade/UpgradePageShell";
import { SyncMembershipSection } from "@/components/upgrade/SyncMembershipSection";
import { publicPageMetadata } from "@/lib/page-metadata";
// /upgrade now lives in the (marketing) group and wears the marketing chrome
// (was the authenticated app shell). Import the app component styles it still
// relies on — `.content-rail`, `.page-shell`, `.upgrade-*` live in globals.css,
// which the lean (marketing) layout does not load. Scoped to this route subtree.
import "../../globals.css";

export const metadata: Metadata = {
  ...publicPageMetadata(
    "Upgrade to BlackOut Premium — Unlock All Tools",
    "Unlock every BlackOut tool — live dealer gamma, HELIX options flow, 0DTE plays, heat maps, and more. Plans from $49/mo, cancel anytime.",
    "/upgrade",
  ),
  robots: { index: false, follow: false },
};

export default async function UpgradePage() {
  return (
    <MarketingPageShell showChart={false}>
      <MarketingClerkBridge>
        <div style={{ paddingTop: "var(--nav-offset)" }}>
          <UpgradePageShell frame={false} syncSlot={<SyncMembershipSection />} />
        </div>
      </MarketingClerkBridge>
    </MarketingPageShell>
  );
}
