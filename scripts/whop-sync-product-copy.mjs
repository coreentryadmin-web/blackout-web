#!/usr/bin/env node
/**
 * Sync Whop product titles + descriptions to match blackouttrades.com pricing.
 * Requires WHOP_API_KEY + WHOP_COMPANY_ID. Idempotent — safe to re-run.
 *
 * Usage: node scripts/whop-sync-product-copy.mjs [--dry-run]
 */
import Whop from "@whop/sdk";

const DRY = process.argv.includes("--dry-run");

const PRODUCT_COPY = {
  prod_DVboHRgi2jgYP: {
    title: "BlackOut Pro Monthly",
    description:
      "Full BlackOut platform access — HELIX live options flow, SPX Slayer 0DTE desk, Largo AI analyst, dealer GEX positioning, Night Hawk evening playbook, strike-level heatmaps, and the graded play log. Includes private Discord. Billed monthly. Cancel anytime. Educational tools only — not financial advice.",
  },
  prod_pufR0xUcudHVB: {
    title: "BlackOut Yearly",
    description:
      "Full BlackOut platform access — everything in Premium Monthly, billed once per year (≈ $167/mo, save $389 vs monthly). Includes private Discord. Cancel anytime. Educational tools only — not financial advice.",
  },
  prod_hPHU7bWcvWg8T: {
    title: "BlackOut Discord Community",
    description:
      "Private Discord server — daily live signals, market reads, real-time session discussions, and evening recaps. Does not include the BlackOut trading platform. Upgrade to Premium anytime for full desk access. Billed monthly. Cancel anytime.",
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
  const listed = [];
  for await (const item of client.products.list({ company_id: companyId })) {
    listed.push(item);
  }

  console.log(`Found ${listed.length} Whop products for ${companyId}`);

  for (const product of listed) {
    const patch = PRODUCT_COPY[product.id];
    if (!patch) {
      console.log(`  skip ${product.id} (${product.title?.trim()}) — no copy template`);
      continue;
    }
    const needsTitle = product.title?.trim() !== patch.title;
    const needsDesc = (product.description ?? "").trim() !== patch.description;
    if (!needsTitle && !needsDesc) {
      console.log(`  ok   ${product.id} (${patch.title})`);
      continue;
    }
    console.log(`  ${DRY ? "would update" : "update"} ${product.id}: title=${needsTitle} desc=${needsDesc}`);
    if (!DRY) {
      await client.products.update(product.id, {
        title: patch.title,
        description: patch.description,
      });
    }
  }

  console.log(DRY ? "Dry run complete." : "Whop product copy sync complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
