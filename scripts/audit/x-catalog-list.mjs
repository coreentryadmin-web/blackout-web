#!/usr/bin/env node
/**
 * Print visual capture catalog summary — browse by product before capturing.
 * Run: npm run x:catalog:list [-- --product helix] [-- --tag whale] [-- --json]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const flag = (k) => args.includes(`--${k}`);

const CATALOG_PATH = join(process.cwd(), "data/x-intel/visual-capture-catalog.json");
const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
const productFilter = opt("product");
const tagFilter = opt("tag");
const asJson = flag("json");

let entries = [];
for (const [product, list] of Object.entries(catalog.products ?? {})) {
  if (productFilter && product !== productFilter) continue;
  for (const e of list) {
    if (tagFilter && !(e.story_tags ?? []).includes(tagFilter)) continue;
    entries.push({ product, ...e });
  }
}

if (asJson) {
  console.log(JSON.stringify({ entry_count: entries.length, entries: entries.map((e) => ({
    id: e.id,
    product: e.product,
    label: e.label,
    recipe: e.recipe,
    path: e.path,
    story_tags: e.story_tags,
    franchises: e.franchises,
    signature_template: e.signature_template,
  })) }, null, 2));
  process.exit(0);
}

console.log(`Visual capture catalog v${catalog.version} — ${catalog.entry_count} entries (${catalog.exported_at})`);
console.log("");
for (const product of Object.keys(catalog.products ?? {}).sort()) {
  if (productFilter && product !== productFilter) continue;
  const list = (catalog.products[product] ?? []).filter((e) =>
    !tagFilter || (e.story_tags ?? []).includes(tagFilter),
  );
  if (!list.length) continue;
  console.log(`${product} (${list.length})`);
  for (const e of list.slice(0, 8)) {
    console.log(`  · ${e.id}`);
    console.log(`    ${e.label}`);
  }
  if (list.length > 8) console.log(`  … +${list.length - 8} more`);
  console.log("");
}

console.log(`Filtered: ${entries.length} entries`);
console.log("Capture: node --import tsx scripts/audit/lib/x-capture-runner.mjs (via captureByCatalogId in drafts/director)");
