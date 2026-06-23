import Link from "next/link";
import { Nav } from "@/components/Nav";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { PlanLadder } from "@/components/upgrade/PlanLadder";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";

export default function UpgradePage() {
  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main max-w-2xl mx-auto text-center">
        <p className="font-mono text-[10px] tracking-[0.4em] text-purple-light uppercase mb-3">
          Membership required
        </p>
        <h1 className="page-title mb-4">Premium Access</h1>
        <p className="text-sky-300 text-sm leading-relaxed mb-8">
          One membership unlocks the live desk — HELIX flow, the SPX dashboard, Largo, Night
          Hawk and more. Pick the plan that fits, pay on Whop with the same email as your
          BlackOut account, then refresh your access below.
        </p>

        <div className="mb-10">
          <PlanLadder />
        </div>

        <SyncMembershipButton />

        <FeatureComparison />

        <p className="text-cyan-400 text-xs mt-8 font-mono">
          <Link href="/" className="text-purple-light hover:text-purple">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
