import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRIMITIVE_SRC = readFileSync(join(__dirname, "vector-volume-profile-primitive.ts"), "utf8");

test("volume profile level labels anchor at gutterLeft, not the price-axis edge", () => {
  assert.match(PRIMITIVE_SRC, /gutterLeft:\s*gutter\.gutterLeft/);
  assert.match(PRIMITIVE_SRC, /textAlign\s*=\s*"left"/);
  assert.match(PRIMITIVE_SRC, /fillText\(lvl\.label,\s*gutterLeft\s*\+\s*4/);
  assert.doesNotMatch(PRIMITIVE_SRC, /fillText\(lvl\.label,\s*rightX\s*-\s*6/);
});
