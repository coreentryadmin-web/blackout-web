export const dynamic = "force-static";

import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { RedesignPricing } from "@/components/landing/RedesignPricing";

export const metadata: Metadata = {
  title: "Pricing · BlackOut",
  description: "Premium membership — full desk access: HELIX flow, SPX Slayer, Largo, Night Hawk, and more.",
};

export default function PricingPage() {
  return (
    <MarketingPageShell showChart={false}>
      <RedesignPricing />
    </MarketingPageShell>
  );
}
