export const SITE = {
  name: "BlackOut Trades",
  legalName: "BlackOut Trading",
  domain: "blackouttrades.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com",
  tagline: "Trade like the lights are on.",
  description:
    "Institutional-grade options flow, dealer positioning, SPX/0DTE structure, catalyst intelligence, and AI-grounded chat — one surface for the floor.",
  /** Social / community handles. This is the canonical source for the desk's
   *  live X account — x-content.ts's X_ACCOUNT_USERNAME and x-whop-link.ts's
   *  ACCOUNT_TAG both derive from `x.handle` below rather than hardcoding it,
   *  so the three can't drift out of sync again (they already did once). The
   *  Whop store link lives in whop-checkout.ts (env-driven) since it's a
   *  purchase entry point. */
  social: {
    x: { handle: "BlackOutTrade", url: "https://x.com/BlackOutTrade" },
    instagram: { handle: "blackouttrades", url: "https://www.instagram.com/blackouttrades" },
    discord: { url: "https://discord.gg/j9FNuBXfMH" },
  },
} as const;
