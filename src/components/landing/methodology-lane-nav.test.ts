import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("methodology page exposes lane jump-nav and section anchors", () => {
  const nav = readFileSync(join(root, "src/components/landing/MethodologyLaneNav.tsx"), "utf8");
  const content = readFileSync(join(root, "src/components/landing/MethodologyContent.tsx"), "utf8");
  const css = readFileSync(join(root, "src/app/marketing-shell.css"), "utf8");

  for (const id of [
    "methodology-spx",
    "methodology-nighthawk",
    "methodology-zerodte",
    "methodology-disclaimer",
  ]) {
    assert.match(content, new RegExp(`id="${id}"`), `missing section anchor ${id}`);
    assert.match(nav, new RegExp(id), `missing nav lane id ${id}`);
  }

  assert.match(content, /MethodologyLaneNav/);
  assert.match(css, /\.methodology-lane-nav/);
  assert.match(css, /scroll-margin-top/);
});
