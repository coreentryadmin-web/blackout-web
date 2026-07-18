import type { ReactNode } from "react";
import { activeClerkUserIdFromRequestCookies } from "@/lib/clerk-session-cookies";
import { StaticLandingBackdrop } from "./StaticLandingBackdrop";
import { StaticMarketingNav } from "./StaticMarketingNav";
import { StaticLandingFooter } from "./StaticLandingFooter";

type Props = {
  children: ReactNode;
  showChart?: boolean;
  footer?: boolean;
};

/** Shared marketing chrome — lean CSS, no Clerk client bundle, no desk Nav. */
export async function MarketingPageShell({ children, showChart = true, footer = true }: Props) {
  const signedIn = Boolean(await activeClerkUserIdFromRequestCookies());

  return (
    <div className="landing-page mkt-page min-h-screen void-bg text-white">
      <StaticLandingBackdrop showChart={showChart} />
      <StaticMarketingNav signedIn={signedIn} />
      <main id="main" className="relative z-10">
        {children}
      </main>
      {footer ? <StaticLandingFooter /> : null}
    </div>
  );
}
