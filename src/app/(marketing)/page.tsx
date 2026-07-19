export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { StaticLandingHero } from "@/components/landing/StaticLandingHero";
import { StaticProductFilmstrip } from "@/components/landing/StaticProductFilmstrip";
import { StaticStatsStrip } from "@/components/landing/StaticStatsStrip";
import { StaticAudienceStrip } from "@/components/landing/StaticAudienceStrip";
import { StaticModuleShowcase } from "@/components/landing/StaticModuleShowcase";
import { StaticTerminalDemo } from "@/components/landing/StaticTerminalDemo";
import { StaticEdgeSection } from "@/components/landing/StaticEdgeSection";
import { StaticPricingCompare } from "@/components/landing/StaticPricingCompare";
import { StaticClosingCta } from "@/components/landing/StaticClosingCta";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";
import { CLERK_DEFAULT_POST_AUTH_PATH } from "@/lib/clerk-redirect-url";

const LANDING_REDIRECT_SCRIPT =
  "try{var h=location.hash.slice(1);if(h==='faq')location.replace('/faq');else if(h==='pricing')location.replace('/pricing');else if(document.documentElement.classList.contains('ios-app'))location.replace('/dashboard')}catch(e){}";

export default async function LandingPage() {
  if (await activeClerkUserIdFromRequestCookies()) {
    redirect(CLERK_DEFAULT_POST_AUTH_PATH);
  }

  return (
    <MarketingPageShell>
      <script dangerouslySetInnerHTML={{ __html: LANDING_REDIRECT_SCRIPT }} />
      <StaticLandingHero />
      <StaticProductFilmstrip />
      <StaticStatsStrip />
      <StaticAudienceStrip />
      <StaticModuleShowcase />
      <StaticTerminalDemo />
      <StaticEdgeSection />
      <StaticPricingCompare />
      <StaticClosingCta />
    </MarketingPageShell>
  );
}
