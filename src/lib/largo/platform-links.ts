import { SITE } from "@/lib/site";
import { siteMarketingUrl, whopMarketingUrl } from "@/lib/x-whop-link";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

/** Canonical member-facing URLs — inject into Largo for social + funnel answers. */
export const LARGO_PLATFORM_LINKS = {
  site: SITE.url,
  pricing: `${SITE.url}/pricing`,
  trackRecord: `${SITE.url}/track-record`,
  signUp: `${SITE.url}/sign-up`,
  x: SITE.social.x.url,
  xHandle: `@${SITE.social.x.handle}`,
  instagram: SITE.social.instagram.url,
  discord: SITE.social.discord.url,
  whopStore: WHOP_CHECKOUT.store || "https://whop.com/blackout-2d9c",
  whopMonthly: WHOP_CHECKOUT.monthly,
  whopYearly: WHOP_CHECKOUT.yearly,
  whopCommunity: WHOP_CHECKOUT.community,
  whopMarketing: whopMarketingUrl("desk_ai"),
  pricingUtm: siteMarketingUrl("desk_ai"),
  desks: {
    spxSlayer: `${SITE.url}/dashboard`,
    helix: `${SITE.url}/flows`,
    thermal: `${SITE.url}/heatmap`,
    vector: `${SITE.url}/vector`,
    nighthawk: `${SITE.url}/nighthawk`,
    grid: `${SITE.url}/grid`,
    largo: `${SITE.url}/terminal`,
    meridian: `${SITE.url}/meridian`,
    heatmap: `${SITE.url}/heatmap`,
  },
} as const;

/** Markdown block for Largo system / social prompts — no vendor names on public copy. */
export function formatLargoPlatformLinksBlock(): string {
  const d = LARGO_PLATFORM_LINKS.desks;
  return `
## Platform links (social + funnel — cite when drafting posts)

**Public brand**
- X: ${LARGO_PLATFORM_LINKS.x} (${LARGO_PLATFORM_LINKS.xHandle})
- Discord community: ${LARGO_PLATFORM_LINKS.discord}
- Instagram: ${LARGO_PLATFORM_LINKS.instagram}

**Member funnel (use in CTA when appropriate)**
- Pricing page: ${LARGO_PLATFORM_LINKS.pricing}
- Track record (public graded stats): ${LARGO_PLATFORM_LINKS.trackRecord}
- Whop store: ${LARGO_PLATFORM_LINKS.whopStore}
- Premium monthly checkout: ${LARGO_PLATFORM_LINKS.whopMonthly || "(env — use pricing page)"}
- SPX Slayer / community tier: ${LARGO_PLATFORM_LINKS.whopCommunity || "(env — use pricing page)"}

**Desk deep links**
- SPX Slayer: ${d.spxSlayer}
- HELIX flow: ${d.helix}
- Thermal: ${d.thermal}
- Vector: ${d.vector}?ticker=SPX
- Night Hawk: ${d.nighthawk}
- 0DTE Command / Grid: ${d.grid}
- Largo terminal: ${d.largo}
- Meridian catalyst desk: ${d.meridian}

**Social CTA rules**
- X posts: default footer ${LARGO_PLATFORM_LINKS.xHandle} · link in bio (pricing in bio)
- When member asks for trackable Whop link in copy: ${LARGO_PLATFORM_LINKS.whopMarketing}
- Discord posts: invite ${LARGO_PLATFORM_LINKS.discord} — never paste internal webhook URLs
- Never invent checkout URLs; use the links above or say "link in bio"
`.trim();
}
