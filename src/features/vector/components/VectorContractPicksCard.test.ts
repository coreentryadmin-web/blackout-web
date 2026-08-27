import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src/features/vector");

test("VectorContractPicksCard: loading and quality-bar-empty states are distinct from silent null", () => {
  const src = readFileSync(join(root, "components/VectorContractPicksCard.tsx"), "utf8");
  // Regression guard for the bug where `if (!picks.length) return null;` fired unconditionally —
  // a member had no way to tell "still fetching" apart from "no contract cleared the bar" apart
  // from "no directional play at all" (the one case that legitimately renders nothing).
  assert.match(src, /if \(!picks\.length\)\s*\{/, "empty-picks branch must be a real block, not a bare return null");
  assert.match(src, /if \(loading\)/, "loading state must be handled before falling through to the quality-bar-empty case");
  assert.match(
    src,
    /play\.bias !== "neutral"/,
    "a neutral/no-bias play still renders nothing — only a real directional play with zero picks gets the empty-state card"
  );
  assert.match(src, /vector-contract-picks-empty/);
});
