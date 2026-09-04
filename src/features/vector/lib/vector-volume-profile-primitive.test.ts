import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "vector-volume-profile-primitive.ts"),
  "utf8"
);

test("volume profile level labels anchor at gutterLeft, not the price axis", () => {
  assert.match(SRC, /labelX:\s*gutter\.gutterLeft\s*\+\s*4/);
  assert.match(SRC, /textAlign\s*=\s*"left"/);
  assert.doesNotMatch(SRC, /rightX\s*-\s*6/);
  assert.doesNotMatch(SRC, /textAlign\s*=\s*"right"/);
});
