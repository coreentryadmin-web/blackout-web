export const SITE = {
  name: "BlackOut Trades",
  legalName: "BlackOut Trading",
  domain: "blackouttrades.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com",
  tagline: "Trade like the lights are on.",
  description:
    "Institutional-grade options flow, dealer positioning, live SPX structure, and the Night Hawk swing scanner — one command surface for the floor.",
  /** Social handles. `x` mirrors X_ACCOUNT_USERNAME in x-content.ts (the desk's
   *  live X account, @BlackOutTrade). */
  social: {
    x: { handle: "BlackOutTrade", url: "https://x.com/BlackOutTrade" },
  },
} as const;
