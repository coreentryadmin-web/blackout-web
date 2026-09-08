import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  "platform/intel/route.ts",
  "coaching/alerts/route.ts",
  "brief/premarket/route.ts",
] as const;

for (const rel of ROUTES) {
  test(`${rel} rounds member-visible floats at the API boundary`, () => {
    const src = readFileSync(join(process.cwd(), "src/app/api", rel), "utf8");
    assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
    assert.match(src, /NextResponse\.json\(roundFloats\(/);
  });
}

test("platform-intel-snapshot rounds floats before Largo/Night Hawk prompt context", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/nighthawk/lib/platform-intel-snapshot.ts"),
    "utf8"
  );
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /return roundFloats\(/);
});
