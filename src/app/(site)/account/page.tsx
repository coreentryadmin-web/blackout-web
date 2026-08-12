import type { Metadata } from "next";
import { PersonalAlertsSettings } from "@/components/account/PersonalAlertsSettings";
import { AccountProfilePanel } from "@/components/account/AccountProfilePanel";
import { AccountMembershipPanel } from "@/components/account/AccountMembershipPanel";
import { AccountPageShell } from "@/components/account/AccountPageShell";
import { noindexPageMetadata } from "@/lib/page-metadata";
// Contrast hardening for the Clerk <UserProfile> widget (fields were dark-on-dark).
import "../../account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = noindexPageMetadata("Account · BlackOut", "/account");

export default function AccountPage() {
  return (
    <AccountPageShell>
      <div className="account-page-title-block mb-6">
        <h1 className="font-syne text-2xl font-bold text-white">Account Settings</h1>
        <p className="font-mono text-[12px] text-sky-300/60 mt-1 uppercase tracking-[0.14em]">
          Profile · Security · Connected devices
        </p>
      </div>
      <AccountProfilePanel />

      <AccountMembershipPanel />

      <div className="account-page-alerts-block mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="font-syne text-lg font-bold text-white">Personal Play Alerts</h2>
        <p className="font-mono text-[11px] text-sky-300/60 mt-1 mb-4 uppercase tracking-[0.1em]">
          Discord webhook · Night Hawk plays
        </p>
        <PersonalAlertsSettings />
      </div>
    </AccountPageShell>
  );
}
