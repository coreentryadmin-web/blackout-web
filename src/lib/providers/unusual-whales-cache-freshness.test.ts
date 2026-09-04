import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/lib/providers/unusual-whales.ts"), "utf8");

test("readUwCache rejects far-future fetchedAt (source scan)", () => {
  assert.match(src, /WS_TIMESTAMP_FUTURE_TOLERANCE_MS/);
  assert.match(
    src,
    /function readUwCache[\s\S]*?age < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS\) return undefined/,
    "in-process UW REST cache must not treat clock-skewed future fetchedAt as fresh"
  );
});
