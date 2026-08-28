import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingClerkBridge } from "@/components/marketing/MarketingClerkBridge";
import { UpgradePageShell } from "@/components/upgrade/UpgradePageShell";
import { SyncMembershipClientSwitch } from "@/components/upgrade/SyncMembershipClientSwitch";
import { SIGN_IN_SYNC_HREF } from "@/components/upgrade/sync-membership-constants";
import { publicPageMetadata } from "@/lib/page-metadata";
import "../../globals.css";

export const metadata: Metadata = {
  ...publicPageMetadata(
    "Upgrade to BlackOut Premium — Unlock All Tools",
    "Unlock every BlackOut tool — live dealer gamma, HELIX options flow, 0DTE plays, heat maps, and more. Plans from $49/mo, cancel anytime.",
    "/upgrade",
  ),
  robots: { index: false, follow: false },
};

const signInSyncLink = (
  <Link href={SIGN_IN_SYNC_HREF} className="btn-outline-bull">
    Sign in to sync purchase
  </Link>
);

export default function UpgradePage() {
  return (
    <MarketingPageShell showChart={false}>
      <MarketingClerkBridge>
        <div style={{ paddingTop: "var(--nav-offset)" }}>
          <UpgradePageShell
            frame={false}
            syncSlot={<SyncMembershipClientSwitch signInLink={signInSyncLink} />}
          />
        </div>
      </MarketingClerkBridge>
    </MarketingPageShell>
  );
}
