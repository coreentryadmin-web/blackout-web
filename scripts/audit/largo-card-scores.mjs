/**
 * WHY DID THIS QUESTION GET THAT CARD?
 *
 * `composeCard` ranks blocks by `base + MATCH_BOOST(question) + density × DENSITY_WEIGHT`, then
 * packs by height. When a card comes back carrying the wrong evidence there are two candidate
 * explanations — it was OUT-SCORED (relevance lost to density) or it was OUT-SIZED (it scored
 * first and did not fit) — and the fix is different for each. Guessing between them is how a
 * tuning constant gets bumped for a packing bug.
 *
 * This prints the full score table plus the chosen/dropped split for a question against a bundle,
 * so the two causes are distinguishable before anything is changed. Offline, read-only.
 *
 *   node --import tsx scripts/audit/largo-card-scores.mjs --bundle=<path.json> [--q="..."] [--size=]
 *
 * `--bundle` takes a `VisualBundle` JSON (a real one — capture it rather than invent it). With no
 * bundle it uses the committed dense fixture, which is a shape check, not evidence about a live
 * question.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";

globalThis.React = React;
const require_ = createRequire(import.meta.url);
require_.cache[require_.resolve("server-only")] = { id: "server-only", exports: {}, loaded: true };

const { BLOCKS, composeCard, scoreBlock, heightBudget } = await import("../../src/lib/largo/visual/compose.ts");
const { sizeSpec } = await import("../../src/lib/largo/visual/sizes.ts");
const { FIXTURE_QUESTION, richFixtureBundle } = await import("../../src/lib/largo/visual/fixture-bundle.ts");

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const bundle = args.has("bundle") ? JSON.parse(readFileSync(args.get("bundle"), "utf8")) : richFixtureBundle();
const question = args.get("q") ?? FIXTURE_QUESTION;

for (const size of (args.get("size") ?? "x_portrait,x_landscape").split(",")) {
  const spec = sizeSpec(size);
  const c = composeCard({ question, bundle, spec });
  const chosen = new Set(c.blocks.map((b) => b.id));
  const dropped = new Set(c.dropped.map((d) => d.id));

  console.log(`\n=== ${size}  "${question}"`);
  console.log(`  budget=${c.budget} used=${c.used} slack=${c.budget - c.used} (heightBudget=${Math.round(heightBudget(spec))})`);
  console.log("  block            base  match  density  weight  height  verdict");
  const rows = BLOCKS.filter((b) => b.available(bundle))
    .map((b) => ({ b, ...scoreBlock(b, question, bundle, null) }))
    .sort((a, z) => z.weight - a.weight);
  for (const { b, weight, matchedIntent } of rows) {
    // OUT-SCORED vs OUT-SIZED is the whole point of this table.
    const verdict = chosen.has(b.id) ? "DRAWN" : dropped.has(b.id) ? "OUT-SIZED (scored, did not fit)" : "not selected";
    console.log(
      `  ${b.id.padEnd(16)} ${String(b.base).padStart(4)}  ${(matchedIntent ? "YES" : "-").padStart(5)}  ${String(b.density(bundle)).padStart(7)}  ${weight.toFixed(1).padStart(6)}  ${String(b.height(bundle, spec)).padStart(6)}  ${verdict}`
    );
  }
  const unavailable = BLOCKS.filter((b) => !b.available(bundle)).map((b) => b.id);
  if (unavailable.length) console.log(`  unavailable (no evidence): ${unavailable.join(", ")}`);
}
