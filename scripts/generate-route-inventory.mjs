#!/usr/bin/env node
/**
 * Emit a machine-readable inventory of all Next.js App Router pages and API routes.
 * Usage: node scripts/generate-route-inventory.mjs [--json]
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src/app");
const JSON_OUT = process.argv.includes("--json");
const OUT_DIR = join(process.cwd(), "audit-output");

function collect(base, acc) {
  for (const entry of readdirSync(base)) {
    const p = join(base, entry);
    if (statSync(p).isDirectory()) {
      collect(p, acc);
      continue;
    }
    const rel = p.replace(ROOT + "/", "").replace(/\\/g, "/");
    if (entry === "page.tsx") {
      acc.pages.push(routeFromSegments(rel.replace(/\/page\.tsx$/, "")));
    } else if (entry === "route.ts") {
      acc.apis.push(routeFromSegments(rel.replace(/\/route\.ts$/, "")));
    }
  }
}

function routeFromSegments(segments) {
  const parts = segments.split("/").filter(Boolean);
  return (
    "/" +
    parts
      .map((s) => {
        if (s.startsWith("(") && s.endsWith(")")) return "";
        if (s.startsWith("[[...") || s.startsWith("[...")) return `:${s.replace(/[\[\].]/g, "")}`;
        return s;
      })
      .filter(Boolean)
      .join("/")
  );
}

const acc = { pages: [], apis: [], generated_at: new Date().toISOString() };
collect(ROOT, acc);
acc.pages.sort();
acc.apis.sort();

if (JSON_OUT) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `route-inventory-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(acc, null, 2));
  console.log(path);
} else {
  console.log(`# Route inventory (${acc.generated_at})\n`);
  console.log(`## Pages (${acc.pages.length})\n`);
  for (const p of acc.pages) console.log(p);
  console.log(`\n## API routes (${acc.apis.length})\n`);
  for (const p of acc.apis) console.log(p);
}
