import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `<CartesianGrid>` must declare a `yAxisId` whenever its chart declares explicit `yAxisId`s.
 *
 * Recharts 3 binds the grid to an axis to source its tick positions, and `CartesianGrid`
 * defaults to `yAxisId={0}`. A chart that names ALL of its Y axes — as the HELIX contract
 * drilldown does (`"vol"` and `"price"`) — therefore has NO axis with id `0` for the grid to
 * read, and recharts 3 responds by rendering only the plot boundary: every interior horizontal
 * line silently disappears. Recharts 2 fell back to the first axis, so the same JSX looked
 * correct for as long as we were on 2.x.
 *
 * Nothing else catches this. `tsc` is happy (`yAxisId` is optional), the component still mounts,
 * the chart still draws its bars, line and axes, and no warning is emitted — the only symptom is
 * two missing hairlines at `rgba(255,255,255,0.06)`. It was found by rendering both majors in a
 * browser and diffing the SVG: `gridHorizontalY` went from `[130, 99, 67, 4]` on 2.15.4 to
 * `[4, 130]` on 3.10.1, and back to `[130, 99, 67, 4]` once the grid named an axis.
 *
 * Adding `yAxisId` is a no-op on recharts 2 (verified pixel-identical), so this rule is safe to
 * apply to every chart regardless of which major is installed.
 */

/**
 * Hand-rolled walk rather than `fs.globSync` — `globSync` landed in Node 22 and CI pins Node 20
 * (`.github/workflows/ci.yml` → `node-version: 20`), so the glob version passes locally and
 * throws `TypeError: globSync is not a function` in CI.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("every CartesianGrid in a chart with named Y axes binds to one of them", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles("src")) {
    const src = readFileSync(file, "utf8");
    if (!/from ["']recharts["']/.test(src)) continue;

    // Only charts that name their Y axes are at risk — a chart relying on the default
    // `yAxisId={0}` still has an axis with that id for the grid to bind to.
    const declaredIds = [...src.matchAll(/yAxisId=["']([^"']+)["']/g)].map((m) => m[1]);
    if (declaredIds.length === 0) continue;

    for (const tag of src.match(/<CartesianGrid[^>]*>/g) ?? []) {
      const bound = tag.match(/yAxisId=["']([^"']+)["']/);
      if (!bound) {
        offenders.push(`${file}: <CartesianGrid> has no yAxisId, but the chart declares ${JSON.stringify([...new Set(declaredIds)])}`);
      } else if (!declaredIds.includes(bound[1])) {
        offenders.push(`${file}: <CartesianGrid yAxisId="${bound[1]}"> matches no declared axis ${JSON.stringify([...new Set(declaredIds)])}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `CartesianGrid not bound to a declared Y axis:\n${offenders.join("\n")}`);
});
