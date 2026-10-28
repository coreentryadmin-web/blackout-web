import type { ReactNode } from "react";
import { StaticLandingBackdrop } from "./StaticLandingBackdrop";
import { StaticMarketingNav } from "./StaticMarketingNav";
import { StaticLandingFooter } from "./StaticLandingFooter";
import { LazyExitIntentCapture } from "@/components/marketing/LazyExitIntentCapture";
import { MarketingScrollProgress } from "./MarketingScrollProgress";
import { SharedSigilDefs } from "@/components/marks/SharedSigilDefs";

type Props = {
  children: ReactNode;
  showChart?: boolean;
  footer?: boolean;
};

/** Shared marketing chrome — lean CSS, no Clerk client bundle, no desk Nav.
 *  Auth CTA defaults to signed-out SSR; NavAuthLinks / MarketingAuthCta heal from
 *  __client_uat on first client paint so marketing pages can be statically cached.
 *
 *  `<SharedSigilDefs/>` is mounted here, NOT only inside the desk `AppShellProviders`
 *  bundle: `<ProductMark>` (/upgrade's AuthProofRail + FeatureComparison, /learn's
 *  LearnHub/LearnSidebar/LearnGuideView/LearnSectionBlocks) is used on pages that live
 *  in the lean (marketing) route group, which never mounts `AppShellProviders` — every
 *  `url(#bo-glow)`/`url(#bo-accent-radial)`/etc. reference in those sigils was dangling
 *  with no matching `id` anywhere in the DOM. `SharedSigilDefs` is a plain, zero-size,
 *  dependency-free server component (no Clerk, no client JS), so sharing it here costs
 *  nothing toward the bundle-size goal the rest of this shell is built around. */
export function MarketingPageShell({ children, showChart = true, footer = true }: Props) {
  return (
    <div className="landing-page mkt-page min-h-screen void-bg text-white">
      <SharedSigilDefs />
      <StaticLandingBackdrop showChart={showChart} />
      <MarketingScrollProgress />
      <StaticMarketingNav signedIn={false} />
      <main id="main" className="relative z-10">
        {children}
      </main>
      {footer ? <StaticLandingFooter /> : null}
      <LazyExitIntentCapture />
    </div>
  );
}
