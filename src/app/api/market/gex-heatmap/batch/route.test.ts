import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("gex-heatmap batch rounds member-visible floats at the API boundary", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/market/gex-heatmap/batch/route.ts"),
    "utf8"
  );
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /NextResponse\.json\(\s*roundFloats\(/);
});
