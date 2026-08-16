import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VECTOR_BEAD_DISPLAY } from "../lib/vector-indicators-config";

const root = join(process.cwd(), "src/features/vector");

test("VectorBeadRailToggle: toolbar chips wired with on/off + GEX-only rings guard", () => {
  const src = readFileSync(join(root, "components/VectorBeadRailToggle.tsx"), "utf8");
  assert.match(src, /VECTOR_BEAD_DISPLAY/);
  assert.match(src, /aria-pressed=\{on\}/);
  assert.match(src, /bead-integrity-rings/s);
  assert.match(src, /bead-event-glyphs/s);
  assert.match(src, /is-bead-events/s);
  assert.match(src, /lens !== "gex"/);
  assert.match(src, /toolbarLabel/);
});

test("VectorToolbar mounts bead-rail chips on desk + compact rows", () => {
  const src = readFileSync(join(root, "components/VectorToolbar.tsx"), "utf8");
  assert.match(src, /VectorBeadRailToggle/);
  const mounts = src.match(/<VectorBeadRailToggle/g) ?? [];
  assert.equal(mounts.length, 3, "desk, compact, compare rows");
});

test("VECTOR_BEAD_DISPLAY: every bead id has a short toolbar label", () => {
  for (const bead of VECTOR_BEAD_DISPLAY) {
    assert.ok(bead.toolbarLabel.length > 0, `${bead.id} has toolbarLabel`);
    assert.ok(bead.toolbarLabel.length <= 8, `${bead.id} toolbar label stays compact`);
  }
});
