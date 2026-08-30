#!/usr/bin/env node
/**
 * Export visual capture catalog → data/x-intel/visual-capture-catalog.json
 * Run: npm run x:catalog:export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportCaptureCatalogJson } from "../../src/lib/x-intel/capture-catalog.ts";

const OUT_DIR = join(process.cwd(), "data/x-intel");
const OUT_FILE = join(OUT_DIR, "visual-capture-catalog.json");

const payload = exportCaptureCatalogJson();
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));

console.log(`Exported ${payload.entry_count} captures across ${payload.product_count} products → ${OUT_FILE}`);
for (const [product, entries] of Object.entries(payload.products)) {
  console.log(`  ${product}: ${entries.length}`);
}
