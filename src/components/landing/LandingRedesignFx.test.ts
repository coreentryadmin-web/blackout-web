import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = readFileSync(join(root, "src/components/landing/LandingRedesignFx.tsx"), "utf8");

test("reduced-motion path still marks the Intelligence Pipeline stages ONLINE", () => {
  // Confirmed live 2026-09-02: curl'd blackouttrades.com's raw HTML shows all four "How
  // BlackOut thinks" pipeline stages stuck at OFFLINE. The stage reveal (OFFLINE -> ONLINE)
  // used to run ONLY inside the scroll-triggered IntersectionObserver set up further down this
  // same effect, and the effect's very first line bails out entirely under
  // `prefers-reduced-motion: reduce` — an accessibility setting real visitors use, and one
  // crawlers/audit tools often default to. That reduced-motion path never touched
  // `[data-pipe-stage]` at all, so those visitors saw the platform advertised as live while
  // every pipeline stage read OFFLINE forever. The fix must apply the ONLINE status directly
  // (no animation) before the early return, not skip it.
  const reduceBlockMatch = src.match(
    /if \(reduce\) \{([\s\S]*?)\n {4}\}\n\n {4}const cleanups/
  );
  assert.ok(reduceBlockMatch, "expected an `if (reduce) { ... }` block before the cleanups array is created");
  const reduceBlock = reduceBlockMatch![1];
  assert.match(
    reduceBlock,
    /data-pipe-stage/,
    "the reduced-motion branch must still touch [data-pipe-stage] elements"
  );
  assert.match(
    reduceBlock,
    />ONLINE/,
    "the reduced-motion branch must set the pipe-status text to ONLINE, not leave it at the OFFLINE default"
  );
});
