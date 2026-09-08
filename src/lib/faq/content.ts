import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import {
  MARKETING_DATA_FRESHNESS,
  PRODUCT_MANIFEST,
  manifestPlatformSummary,
  manifestProductCount,
} from "@/lib/marketing/product-manifest";

export const FAQ_SUPPORT_EMAIL = "support@blackouttrades.com";

export type FaqCatKey = "platform" | "arsenal" | "signals" | "member" | "start";

export type FaqCategory = {
  key: FaqCatKey;
  label: string;
  n: string;
  blurb: string;
  wide?: boolean;
};

export type FaqItem = {
  id: string;
  catKey: FaqCatKey;
  cat: string;
  q: string;
  a: string;
};

export const FAQ_CATEGORIES: FaqCategory[] = [
  { key: "platform", label: "Platform", n: "01", blurb: "What BlackOut is, and how it runs." },
  {
    key: "arsenal",
    label: "Instruments",
    n: "02",
    blurb: "Every instrument on the desk, broken down.",
  },
  { key: "signals", label: "Signals & Data", n: "03", blurb: "Alerts, latency, and the proof." },
  {
    key: "member",
    label: "Membership",
    n: "04",
    blurb: "Access, pricing, and cancellation.",
    wide: true,
  },
  {
    key: "start",
    label: "Getting Started",
    n: "05",
    blurb: "From zero to live in one session.",
    wide: true,
  },
];

/** Token substitutions for FAQ answers that quote a live membership price — keeps
 *  the shared FAQ source in sync with MEMBERSHIP_PRICING automatically instead of
 *  hardcoding a price string per-surface that can silently drift out of date. */
const FAQ_PRICE_TOKENS: Record<string, string> = {
  communityPrice: `${usd(MEMBERSHIP_PRICING.community)}/mo`,
  premiumMonthly: `${usd(MEMBERSHIP_PRICING.monthly)}/mo`,
  premiumYearly: `${usd(MEMBERSHIP_PRICING.yearly)}/yr`,
};

function resolvePriceTokens(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => FAQ_PRICE_TOKENS[key] ?? match);
}

const RAW: Record<FaqCatKey, { q: string; a: string }[]> = {
  platform: [
    {
      q: "What exactly is BlackOut?",
      a: `BlackOut is an institutional-grade trading intelligence platform built for options and 0DTE traders. It combines live options flow, SPX Slayer, dealer gamma positioning, dark-pool activity, Largo analysis, and Night Hawk's 0DTE Command desk into one surface — ${manifestPlatformSummary()} — what a professional desk sees, built for individual traders.`,
    },
    {
      q: "Who is BlackOut built for?",
      a: "Active options, SPX and 0DTE traders — anyone who wants real structure on the screen instead of a hunch. Serious beginners are covered by the in-app Learn layer; full-time operators get a command surface dense enough to run a whole session from.",
    },
    {
      q: "Where does your data come from?",
      a: "Aggregated from professional-grade options and equity feeds, streamed live. We merge dealer positioning, options flow, dark-pool prints, and full market internals into one clean signal layer — the depth the pros run on, without stitching together a dozen terminals yourself.",
    },
    {
      q: "Do I need to connect a broker?",
      a: "No. BlackOut is a pure intelligence layer — you execute on your own broker. We surface live structure, positioning, and graded setups from observable market data; you pull the trigger wherever you already trade.",
    },
    {
      q: "Is any of this financial advice?",
      a: "No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Nothing here is a recommendation to buy or sell — every trade is your own decision. We just make sure you're never guessing the structure.",
    },
    {
      q: "Can I use BlackOut on my phone?",
      a: "Yes. BlackOut installs as an app on your phone — an alert-first, glanceable command surface built for the way 0DTE traders actually live during market hours.",
    },
  ],
  arsenal: [
    {
      q: "What is the SPX Slayer desk?",
      a: "The primary 0DTE desk. Live SPX with VWAP, gamma exposure and market internals, plus a graded play card: letter grade (A–F), numeric score, confidence read, an 11-point confirmation checklist (MTF, trend, structure, VWAP, flow, dark pool, tide, internals, catalyst, dealer GEX, vol regime), a suggested strike with entry / target / stop — and the invalidation level. It answers what's the setup and what's the risk in a single glance.",
    },
    {
      q: "What is Largo, the BlackOut Intelligence desk analyst?",
      a: "Largo is your BlackOut Intelligence desk analyst with full access to every tool's live data — flow, gamma, dark pool, the desk, news. Ask it anything in plain English: 'what's the SPX setup right now,' 'is this flow real or noise,' 'where are dealers trapped.' It answers grounded in live data and shows its work — never a guess pulled from thin air.",
    },
    {
      q: "What is the HELIX options-flow feed?",
      a: "Live options flow filtered down to what moves the desk, not a firehose: repeated-hit strike stacks (same-strike accumulation), sweeps versus blocks, call/put pressure, premium and fill counts. The engine merges the live feed with the full session's flow so the big prints never slip past.",
    },
    {
      q: "What is GEX / dealer positioning?",
      a: "Dealer gamma exposure, made actionable. The support and resistance gamma walls, the gamma flip level, and the regime read — positive gamma (dips get bought, range-bound) versus negative gamma (volatility expands). In short: what market makers are forced to do, and where liquidity is likely to pull price.",
    },
    {
      q: "What does the dark-pool view show?",
      a: "Off-exchange institutional prints and levels, anchored to price — where size is quietly accumulating or distributing away from the lit tape. The flow that prints in the dark, surfaced next to the level it sits on.",
    },
    {
      q: "What is Night Hawk?",
      a: PRODUCT_MANIFEST.hawk.faqAnswer,
    },
    {
      q: "Is there a market overview / heatmap?",
      a: "Yes — a dealer-positioning heatmap. It maps GEX, VEX, DEX and CHARM by strike: the gamma walls that pin or repel price, the flip level where the regime turns, and where dealer flow concentrates. You read market structure before the first trade goes on, not a stale sector grid.",
    },
  ],
  signals: [
    {
      q: "How do alerts work?",
      a: "BlackOut surfaces live, in-app alerts the moment flow and desk state change — a setup moving to WATCH, a play promoting to ENTRY, unusual flow stacking into a level. The signal reaches you in real time, so you act on structure forming, not after it's gone.",
    },
    {
      q: "Is the data really real-time?",
      a: MARKETING_DATA_FRESHNESS.platform,
    },
    {
      q: "Do you track your performance?",
      a: "Yes — transparently. BlackOut keeps an append-only log of every closed SPX setup, scored by its original grade, with best- and worst-case excursion recorded — not a cherry-picked highlight reel. You judge the grader on its own logged results, not our word. Past performance is no guarantee of future results.",
    },
  ],
  member: [
    {
      q: "How do I get access?",
      a: `Create your free BlackOut account, then pick a plan: SPX Slayer ($49/mo) for SPX desk access — live regime, GEX, 0DTE graded plays — or Premium ($199/mo or $1,999/yr) to unlock the full platform with all ${manifestProductCount()} products. Same email, same login — upgrade anytime from your account.`,
    },
    {
      q: "What's the difference between SPX Slayer and Premium?",
      a: `SPX Slayer ({{communityPrice}}) unlocks the live SPX/SPXW desk — regime, GEX, graded 0DTE plays, and strike heatmaps — plus Discord. Premium ({{premiumMonthly}} or {{premiumYearly}}) adds every product: HELIX live flow, Largo AI, ${PRODUCT_MANIFEST.hawk.planInclude}, Thermal multi-ticker heatmaps, Vector universe scanner, Meridian, and the full graded play log.`,
    },
    {
      q: "Can I upgrade from SPX Slayer to Premium later?",
      a: "Yes — upgrade from your account at any time. Your SPX Slayer subscription is replaced by Premium, which includes everything in SPX Slayer plus the full platform.",
    },
    {
      q: "What's included in Premium?",
      a: "The entire arsenal, one membership: the SPX Slayer desk, the HELIX live flow feed, Largo, GEX / dealer positioning, dark-pool activity, Night Hawk, the market heatmap, the graded play log — and full Discord access. One tier, full clearance — nothing held back.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Yes. Go to Account → Membership & Billing and click \"Manage subscription\" — that opens your secure billing portal, where you can update your card, switch plans, or cancel. Questions about a charge, an invoice, or your plan? Email billing@blackouttrades.com and we'll sort it out personally.",
    },
    {
      q: "Is there a refund if it's not for me?",
      a: "Annual plans: full refund within the first 7 days, no questions asked. Monthly plans are billed cycle-to-cycle with no long-term contract — cancel anytime and you won't be charged again, though the current cycle isn't refunded.",
    },
  ],
  start: [
    {
      q: "How do I get started in 5 minutes?",
      a: "Create your account, then open the desk that matches how you trade — not everyone's first stop should be the same product. Focused on SPX/SPXW 0DTE? Start with the SPX Slayer desk. On Premium: flow-driven? Start with HELIX. Trade earnings? Start with Meridian. Scan the whole market for setups? Start with Vector. Then ask Largo your first question ('what's the setup right now?') and, if you're newer to options, work through the in-app Learn layer. Inside your first session you'll have that desk's full read in front of you.",
    },
    {
      q: "How do I reach the team?",
      a: `Email us anytime at ${FAQ_SUPPORT_EMAIL} — real people, fast replies. Billing, access, a feature request, or a question about a setup: it reaches the desk.`,
    },
  ],
};

export const FAQ_ITEMS: FaqItem[] = FAQ_CATEGORIES.flatMap((c) =>
  RAW[c.key].map((it, i) => ({
    id: `${c.key}-${i + 1}`,
    catKey: c.key,
    cat: c.label,
    q: it.q,
    a: resolvePriceTokens(it.a),
  }))
);

/** Look up a curated, ordered subset of FAQ_ITEMS by id — the mechanism every
 *  surface below uses instead of hand-retyping a copy of the question/answer
 *  that can silently drift from the canonical wording. Throws on an unknown
 *  id so a typo or a RAW renumber fails at build time, not by silently
 *  dropping a question from a live page. */
export function selectFaqItems(ids: readonly string[]): FaqItem[] {
  return ids.map((id) => {
    const item = FAQ_ITEMS.find((it) => it.id === id);
    if (!item) throw new Error(`selectFaqItems: unknown FAQ id "${id}"`);
    return item;
  });
}

/** Homepage inline accordion (RedesignHome.tsx) + its FAQPage JSON-LD
 *  ((marketing)/page.tsx) — both render selectFaqItems(HOME_FAQ_IDS) directly,
 *  so the schema.org markup Google indexes can never say something different
 *  from what a visitor actually sees (previously true — see FINDINGS #10). */
export const HOME_FAQ_IDS = ["member-5", "platform-4", "member-2", "platform-5", "start-1"] as const;

/** /pricing's objection-handling FAQ block (RedesignPricing.tsx) + its
 *  FAQPage JSON-LD (pricing/page.tsx). */
export const PRICING_FAQ_IDS = ["member-5", "member-6", "member-2", "platform-5"] as const;
