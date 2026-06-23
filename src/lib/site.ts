export const SITE = {
  name: "BlackOut Trades",
  legalName: "BlackOut Trading",
  domain: "blackouttrades.com",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://blackouttrades.com",
  tagline: "See the structure. Make the call.",
  description:
    "Institutional-grade options flow, dealer positioning, live SPX structure, and the Night Hawk swing scanner — one command surface for the floor.",
} as const;
