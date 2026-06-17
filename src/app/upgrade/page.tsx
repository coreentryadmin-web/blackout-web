import Link from "next/link";
import { Nav } from "@/components/Nav";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { TIER_LABELS, type Tier } from "@/lib/tiers";

const CHECKOUT = {
  pro: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_PRO ?? "",
  elite: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_ELITE ?? "",
};

export default function UpgradePage({
  searchParams,
}: {
  searchParams: { plan?: string };
}) {
  const required = (searchParams.plan === "elite" ? "elite" : "pro") as Tier;
  const checkoutUrl = CHECKOUT[required];

  return (
    <div className="page-shell">
      <Nav />
      <main className="page-main max-w-xl mx-auto text-center">
        <p className="font-mono text-[10px] tracking-[0.4em] text-purple-light uppercase mb-3">
          Membership required
        </p>
        <h1 className="page-title mb-4">Upgrade to {TIER_LABELS[required]}</h1>
        <p className="text-grey-400 text-sm leading-relaxed mb-8">
          This feature is part of the {TIER_LABELS[required]} plan. Pay on Whop using the
          same email as your BlackOut account, then refresh your access below.
        </p>

        {checkoutUrl ? (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-block mb-6"
          >
            Subscribe on Whop →
          </a>
        ) : (
          <p className="text-bear text-sm mb-6">
            Whop checkout URL is not configured yet. Contact support.
          </p>
        )}

        <SyncMembershipButton />

        <p className="text-grey-600 text-xs mt-8 font-mono">
          Already subscribed?{" "}
          <Link href="/dashboard" className="text-purple-light hover:text-purple">
            Back to dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}
