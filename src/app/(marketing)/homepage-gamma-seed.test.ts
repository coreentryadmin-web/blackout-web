import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = readFileSync(join(__dirname, "page.tsx"), "utf8");
// Strip block comments before asserting — the file's own incident-trace comment names
// `buildPublicGexSnapshot` in prose (as the thing NOT to call), which would otherwise
// false-positive the doesNotMatch check below.
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "");

// Regression for a production incident (2026-09-03): the homepage is ISR (`revalidate = 3600`),
// so its gamma seed must come from `readPublicGexSnapshotSeed` (cache-only) — never from
// `buildPublicGexSnapshot`, whose live-compute path trips Next's "Dynamic server usage" bailout
// when invoked from a statically-rendered page and poisons the shared snapshot cache for every
// other reader. See `public-gex-snapshot.ts`'s own comment on `readPublicGexSnapshotSeed` for the
// full incident trace, and `public-gex-snapshot-seed.test.ts` for the behavioral proof.
test("homepage seeds its gamma panel from the cache-only reader, never the live-compute builder", () => {
  assert.match(PAGE_CODE, /readPublicGexSnapshotSeed/);
  assert.doesNotMatch(
    PAGE_CODE,
    /buildPublicGexSnapshot/,
    "the homepage (ISR) must never call the live-compute snapshot builder directly"
  );
});
