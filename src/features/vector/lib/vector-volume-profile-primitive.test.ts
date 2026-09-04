import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("volume profile level labels anchor at gutterLeft, not the price axis", () => {
  const src = readFileSync(join(__dirname, "vector-volume-profile-primitive.ts"), "utf8");
  assert.match(src, /labelX:\s*gutter\.gutterLeft\s*\+\s*4/);
  assert.match(src, /textAlign\s*=\s*"left"/);
  assert.doesNotMatch(src, /rightX\s*-\s*6/);
});
