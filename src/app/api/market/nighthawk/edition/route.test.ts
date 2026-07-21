import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Edition serve-path contracts: carry is live-only; stale fallback when edition_for mismatches.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("edition route: carry_until_close only when date param is omitted (not historical ?date=)", () => {
  const src = read("src/app/api/market/nighthawk/edition/route.ts");
  assert.match(src, /const explicitDate = req\.nextUrl\.searchParams\.get\("date"\)/);
  assert.match(src, /!explicitDate &&[\s\S]*carry_until_close = true/);
});

test("edition route: latest fallback marks stale when served edition_for !== requested", () => {
  const src = read("src/app/api/market/nighthawk/edition/route.ts");
  assert.match(
    src,
    /if \(edition\.edition_for && edition\.edition_for !== editionFor\) \{\s*edition\.stale = true;/,
    "prior session plays must not masquerade as tonight's live board"
  );
});
