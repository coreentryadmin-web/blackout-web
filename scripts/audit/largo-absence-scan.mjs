#!/usr/bin/env node
/**
 * LARGO ABSENCE SCAN — which unavailable payloads still hand the model a number?
 *
 * Read-only. See `lib/absence-scan.mjs` for the class this finds and why it is not yet a CI
 * ratchet. Exits 1 when anything is found, so it can be wired into a gate later without changing
 * its output.
 *
 *   node scripts/audit/largo-absence-scan.mjs [--roots=src/lib/largo,src/lib/zerodte] [--json]
 */
import { DEFAULT_ROOTS, scanRoots } from "./lib/absence-scan.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const roots = (arg("roots", "") || "").split(",").map((r) => r.trim()).filter(Boolean);
const found = scanRoots(roots.length ? roots : DEFAULT_ROOTS);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ roots: roots.length ? roots : DEFAULT_ROOTS, found }, null, 2));
} else if (!found.length) {
  console.log("No unavailable payload carries a countable empty. (Roots: " + (roots.length ? roots : DEFAULT_ROOTS).join(", ") + ")");
} else {
  console.log("Unavailable payloads that still hand the model a number or a list:\n");
  for (const { file, sites } of found) {
    const all = [...new Set(sites.flatMap((s) => s.empties))];
    console.log(`  ${file}`);
    console.log(`      lines ${sites.map((s) => s.line).join(", ")} — ${all.join(", ")}`);
  }
  console.log(
    `\n${found.length} file(s). Each is "there is no data" and "the data is zero" in one payload. ` +
      `A model reads the number.`
  );
}
process.exit(found.length ? 1 : 0);
