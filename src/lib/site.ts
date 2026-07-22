export const SITE = {
  name: "BlackOut Trades",
  legalName: "BlackOut Trading",
  domain: "blackouttrades.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com",
  tagline: "Trade like the lights are on.",
  description:
    "Institutional-grade options flow, dealer positioning, live SPX structure, and the Night Hawk swing scanner — one command surface for the floor.",
  /** Social / community handles. `x` mirrors X_ACCOUNT_USERNAME in x-content.ts
   *  (the desk's live X account, @BlackOutTrade). The Whop store link lives in
   *  whop-checkout.ts (env-driven) since it's a purchase entry point. */
  social: {
    x: { handle: "BlackOutTrade", url: "https://x.com/BlackOutTrade" },
    instagram: { handle: "blackouttrades", url: "https://www.instagram.com/blackouttrades" },
    discord: { url: "https://discord.gg/r8AEcnDCv" },
  },
} as const;
