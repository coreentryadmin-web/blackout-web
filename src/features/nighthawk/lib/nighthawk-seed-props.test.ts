import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = join(process.cwd(), "src/app/(site)/nighthawk/page.tsx");
const helper = join(process.cwd(), "src/features/nighthawk/lib/nighthawk-seed-props.ts");
const shell = join(process.cwd(), "src/features/nighthawk/components/NighthawkPageShell.tsx");
const feed = join(process.cwd(), "src/features/nighthawk/components/NightHawkFeed.tsx");
const containers = join(process.cwd(), "src/features/nighthawk/command-deck/containers.tsx");

test("Night Hawk page SSR-seeds via loadNightHawkSeedProps (Vector-style)", () => {
  const src = readFileSync(page, "utf8");
  assert.match(src, /loadNightHawkSeedProps/);
  assert.match(src, /NighthawkPageShell/);
});

test("seed helper calls getZeroDteBoardPayload (same path as board API)", () => {
  const src = readFileSync(helper, "utf8");
  assert.match(src, /getZeroDteBoardPayload/);
  assert.match(src, /import "server-only"/);
});

test("shell + feed + ZeroDteDeck accept board seed / SWR fallbackData", () => {
  assert.match(readFileSync(shell, "utf8"), /seed/);
  assert.match(readFileSync(feed, "utf8"), /seed/);
  assert.match(readFileSync(containers, "utf8"), /fallbackData/);
  assert.match(readFileSync(containers, "utf8"), /initialBoard/);
});
