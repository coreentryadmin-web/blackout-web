import type { ReactNode } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";
import { usd, MEMBERSHIP_PRICING } from "@/lib/pricing";

const ICON_X =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const ICON_DISCORD =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

function SvgIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  );
}

type CardProps = {
  href: string;
  external?: boolean;
  kicker: string;
  title: string;
  detail: string;
  icon: ReactNode;
  accent?: "cyan" | "bull" | "violet";
};

function CommunityCard({ href, external, kicker, title, detail, icon, accent = "cyan" }: CardProps) {
  const className = `community-card community-card-${accent}`;
  const inner = (
    <>
      <span className="community-card-icon">{icon}</span>
      <span className="community-card-kicker">{kicker}</span>
      <span className="community-card-title">{title}</span>
      <span className="community-card-detail">{detail}</span>
      <span className="community-card-go">Open →</span>
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} prefetch={false} className={className}>
      {inner}
    </Link>
  );
}

/** Homepage community + checkout rail — honest tier copy (Discord is not free). */
export function HomeCommunityRail() {
  const whopStore = WHOP_CHECKOUT.store || "/pricing";
  const discordHref = WHOP_CHECKOUT.community || "/pricing";

  return (
    <section className="sec-community" id="community">
      <div className="w">
        <div className="community-head">
          <span className="kk">
            <span className="dot" />
            Stay connected
          </span>
          <h2>
            Follow the desk.<br />
            <span className="gt">Join the floor.</span>
          </h2>
          <p className="community-sub">
            Market reads and session color on X are free. Discord access ships with a paid membership — Premium
            includes the full platform plus the private server.
          </p>
        </div>

        <div className="community-grid">
          <CommunityCard
            href={SITE.social.x.url}
            external
            kicker="Free"
            title={`Follow @${SITE.social.x.handle}`}
            detail="Live session notes, desk screenshots, and market context on X."
            icon={<SvgIcon d={ICON_X} />}
            accent="bull"
          />

          {WHOP_CHECKOUT.store ? (
            <CommunityCard
              href={WHOP_CHECKOUT.store}
              external
              kicker="Checkout"
              title="View plans on Whop"
              detail={`SPX Slayer from ${usd(MEMBERSHIP_PRICING.community)}/mo · Premium from ${usd(MEMBERSHIP_PRICING.monthly)}/mo.`}
              icon={
                <span className="community-whop-mark" aria-hidden>
                  W
                </span>
              }
              accent="violet"
            />
          ) : (
            <CommunityCard
              href="/pricing"
              kicker="Plans"
              title="See membership options"
              detail="Compare SPX Slayer and Premium tiers on the pricing page."
              icon={
                <span className="community-whop-mark" aria-hidden>
                  W
                </span>
              }
              accent="violet"
            />
          )}

          <CommunityCard
            href={discordHref}
            external={Boolean(WHOP_CHECKOUT.community)}
            kicker="Members"
            title="Join the Discord"
            detail={
              WHOP_CHECKOUT.community
                ? "Private server — Community Discord tier or included with Premium."
                : "Included with Community and Premium — see pricing for access."
            }
            icon={<SvgIcon d={ICON_DISCORD} size={20} />}
            accent="cyan"
          />
        </div>
      </div>
    </section>
  );
}
