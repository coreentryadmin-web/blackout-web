import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inferWhenForDate } from "./earnings";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("readGridEarnings falls back to Alpha Vantage when UW path is absent", () => {
  const src = readFileSync(join(ROOT, "src/lib/zerodte/earnings.ts"), "utf8");
  assert.match(src, /readAvEarningsSnapshot/);
  assert.match(src, /earnings-calendar:av:3m/);
});

test("warmGridEarnings races UW reads so zerodte-warm handshake stays under edge timeout", () => {
  const src = readFileSync(join(ROOT, "src/lib/zerodte/earnings.ts"), "utf8");
  assert.match(src, /export async function warmGridEarnings/);
  assert.match(src, /UW_READ_RACE_MS/);
  assert.match(src, /readAvEarningsSnapshot/);
});

test("inferWhenForDate: same-day before noon ET → premarket", () => {
  const nineAmEt = Date.parse("2026-07-31T13:00:00.000Z");
  assert.equal(inferWhenForDate("2026-07-31", "2026-07-31", "2026-08-01", nineAmEt), "premarket");
});

test("scan.ts treats a successful earnings read (including AV fallback) as available", () => {
  const scan = readFileSync(join(ROOT, "src/lib/zerodte/scan.ts"), "utf8");
  assert.match(scan, /readGridEarnings/);
  assert.match(scan, /unavailable: false/);
});
