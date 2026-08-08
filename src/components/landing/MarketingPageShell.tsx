import type { ReactNode } from "react";
import { StaticLandingBackdrop } from "./StaticLandingBackdrop";
import { StaticMarketingNav } from "./StaticMarketingNav";
import { StaticLandingFooter } from "./StaticLandingFooter";
import { LazyExitIntentCapture } from "@/components/marketing/LazyExitIntentCapture";

type Props = {
  children: ReactNode;
  showChart?: boolean;
  footer?: boolean;
};

/** Shared marketing chrome — lean CSS, no Clerk client bundle, no desk Nav.
 *  Auth CTA defaults to signed-out SSR; NavAuthLinks / MarketingAuthCta heal from
 *  __client_uat on first client paint so marketing pages can be statically cached. */
export function MarketingPageShell({ children, showChart = true, footer = true }: Props) {
  return (
    <div className="landing-page mkt-page min-h-screen void-bg text-white">
      <StaticLandingBackdrop showChart={showChart} />
      <StaticMarketingNav signedIn={false} />
      <main id="main" className="relative z-10">
        {children}
      </main>
      {footer ? <StaticLandingFooter /> : null}
      <LazyExitIntentCapture />
    </div>
  );
}
