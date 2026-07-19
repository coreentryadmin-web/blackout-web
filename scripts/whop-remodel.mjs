#!/usr/bin/env node
/**
 * Full Whop store remodel — product headlines/descriptions, plan labels, hygiene.
 * Run after pricing/copy changes on blackouttrades.com.
 *
 *   node scripts/whop-remodel.mjs [--dry-run]
 *
 * Requires: WHOP_API_KEY (access_pass:update, plan:update). Company update needs company:update.
 */
import Whop from "@whop/sdk";

const DRY = process.argv.includes("--dry-run");
const REDIRECT_AFTER_CHECKOUT = "https://blackouttrades.com/dashboard";
const STATEMENT_DESCRIPTOR = "WHOP*BLACKOUT";
const MAX_DESC = 1480;

const COMPANY = {
  title: "BlackOut Trades",
  description: `BlackOut is a live options trading desk — six integrated modules on one platform: HELIX flow, SPX Slayer 0DTE, Largo AI, Night Hawk, Thermal heatmaps, and a graded play log. Community Discord $75/mo or Premium $199/mo / $1,999/yr. Sign up free at blackouttrades.com, checkout with the same email. Educational tools only — not financial advice.`,
  target_audience:
    "Active SPX and 0DTE options traders who want institutional-grade flow, dealer gamma, and AI desk tools in one platform.",
  social_links: [
    { website: "website", url: "https://blackouttrades.com" },
    { website: "x", url: "https://x.com/black_OutTrade" },
  ],
};

const FAQ = `
FAQ — Premium: full desk + Discord. Community: Discord-only ($75). Data is licensed, live during RTH. No broker link required. Same email at blackouttrades.com + checkout. Cancel anytime; billing@blackouttrades.com for help.`;

const COMMUNITY_FAQ = `
FAQ — Discord-only: signals, reads, recaps. No web platform. Upgrade to Premium anytime. Same email at blackouttrades.com. Cancel anytime.`;

function cap(text) {
  const t = text.trim();
  return t.length <= MAX_DESC ? t : `${t.slice(0, MAX_DESC - 1)}…`;
}

const PRODUCTS = {
  prod_DVboHRgi2jgYP: {
    title: "BlackOut Premium Monthly",
    headline: "Six modules. One desk. Live tape.",
    description: cap(`Full BlackOut platform — $199/mo, cancel anytime.

• HELIX live options-flow (tick-by-tick)
• SPX Slayer 0DTE gamma matrix + trade alerts
• Largo AI desk analyst on live tape
• Dealer GEX / charm heatmaps
• Night Hawk evening playbook
• Graded play log (A–F track record)
• Private Discord included

Create a free account at blackouttrades.com, then checkout with the same email.${FAQ}`),
    custom_cta: "join",
    store_page_config: { custom_cta: "Unlock Premium", show_price: true },
  },
  prod_pufR0xUcudHVB: {
    title: "BlackOut Premium Yearly",
    headline: "Best value — full desk at ≈ $167/mo",
    description: cap(`Everything in Premium Monthly — $1,999/yr (save $389 vs monthly).

Full desk: HELIX, SPX Slayer, Largo, Night Hawk, Thermal, play log + Discord.

Sign up at blackouttrades.com, checkout with the same email.${FAQ}`),
    custom_cta: "join",
    store_page_config: { custom_cta: "Save $389 / Yearly", show_price: true },
  },
  prod_hPHU7bWcvWg8T: {
    title: "BlackOut Discord Community",
    headline: "The room — live signals, daily reads, Discord",
    description: cap(`Private Discord for SPX-focused traders — $75/mo.

• Daily live signals & market reads
• Real-time session discussions
• Evening recaps & next-day prep
• Upgrade to Premium anytime

Does not include SPX Slayer, HELIX, Largo, or heatmaps (Premium only).

Free account at blackouttrades.com, checkout with same email.${COMMUNITY_FAQ}`),
    custom_cta: "join",
    store_page_config: { custom_cta: "Join Community", show_price: true },
  },
  prod_fSnPbyYQi50Wm: {
    title: "Life Time Access",
    visibility: "hidden",
    description: "Retired — choose Premium Monthly or Yearly.",
  },
};

const PLANS = {
  plan_prNHPwrOyFlm2: {
    title: "Premium Monthly — $199/mo",
    description: "Full desk + Discord. Billed monthly.",
  },
  plan_SHrlav6gsTE0P: {
    title: "Premium Yearly — $1,999/yr",
    description: "Full desk + Discord. Save $389 vs monthly.",
  },
  plan_F6TycpzlDjfql: {
    title: "Community Discord — $75/mo",
    description: "Discord-only. Upgrade to Premium anytime.",
  },
  plan_GMS9jVmX6paTb: {
    visibility: "archived",
    title: "Retired lifetime (archived)",
  },
};

async function main() {
  const apiKey = process.env.WHOP_API_KEY?.trim();
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!apiKey || !companyId) {
    console.error("Missing WHOP_API_KEY or WHOP_COMPANY_ID");
    process.exit(1);
  }

  const client = new Whop({ apiKey });
  console.log(DRY ? "[dry-run] Whop remodel" : "Applying Whop remodel…");

  try {
    if (!DRY) await client.companies.update(companyId, { ...COMPANY });
    console.log(`  company: ${COMPANY.title}`);
  } catch (err) {
    console.warn(`  company: skipped (${err?.error?.error?.message ?? err.message})`);
  }

  for (const [id, patch] of Object.entries(PRODUCTS)) {
    const body = {
      ...patch,
      redirect_purchase_url: patch.visibility === "hidden" ? undefined : REDIRECT_AFTER_CHECKOUT,
      custom_statement_descriptor:
        patch.visibility === "hidden" ? undefined : STATEMENT_DESCRIPTOR,
      send_welcome_message: patch.visibility === "hidden" ? undefined : true,
    };
    console.log(`  product ${id}: ${patch.title}${patch.visibility ? ` (${patch.visibility})` : ""} [${(patch.description ?? "").length} chars]`);
    if (!DRY) await client.products.update(id, body);
  }

  for (const [id, patch] of Object.entries(PLANS)) {
    console.log(`  plan ${id}: ${patch.title ?? patch.visibility ?? "update"}`);
    if (!DRY) await client.plans.update(id, patch);
  }

  console.log(DRY ? "Dry run complete." : "Whop remodel applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
