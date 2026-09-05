/**
 * Regression: Legacy Night Hawk stock quotes must rebase push change_pct against the last
 * REST anchor — same discipline as ThermalTripleDesk / ThermalCompareStrip (2026-09-05).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src/features/nighthawk/command-deck/use-legacy-quotes.ts"),
  "utf8",
);

test("useLegacyStockQuotes: imports rebaseChangePct and keeps REST anchor for push overlay", () => {
  assert.match(src, /import \{ rebaseChangePct \} from "@\/lib\/providers\/change-pct"/);
  assert.match(src, /restAnchor: \{ price, change_pct: changePct \}/);
  assert.match(src, /rebaseChangePct\(price, old\.restAnchor\)/);
  assert.match(src, /applyPushQuote\(ticker, q\.price, q\.changePct, q\.asof\)/);
});
