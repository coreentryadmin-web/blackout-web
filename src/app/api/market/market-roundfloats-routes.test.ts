import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "market/gex-heatmap/batch/route.ts",
  "market/spx/commentary/route.ts",
  "market/meridian/event/route.ts",
  "market/meridian/timeline/route.ts",
  "market/meridian/lookup/route.ts",
  "market/meridian/peer-reactions/route.ts",
] as const;

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(process.cwd(), "src/app/api", rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /roundFloats\(/);
    assert.match(src, /NextResponse\.json\([\s\S]*roundFloats/);
  });
}
