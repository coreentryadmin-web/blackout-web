import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sources = [
  {
    file: "src/features/spx/lib/spx-play-options.ts",
    label: "ticketCache",
    fresh: /isWsUpdatedAtFresh\(ticketCache\.at, 45_000, now\)/,
    stale: /now - ticketCache\.at < 45_000/,
  },
  {
    file: "src/features/spx/lib/spx-play-technicals.ts",
    label: "technicals cache",
    fresh: /isWsUpdatedAtFresh\(cached\.at, cacheMs, now\)/,
    stale: /now - cached\.at < cacheMs/,
  },
  {
    file: "src/features/spx/lib/spx-play-telemetry.ts",
    label: "adaptive gates cache",
    fresh: /isWsUpdatedAtFresh\(cached\.at, CACHE_MS, now\)/,
    stale: /now - cached\.at < CACHE_MS/,
  },
  {
    file: "src/features/spx/lib/spx-lotto-options.ts",
    label: "lotto ticket cache",
    fresh: /isWsUpdatedAtFresh\(lottoTicketCache\.at, 60_000, now\)/,
    stale: /now - lottoTicketCache\.at < 60_000/,
  },
] as const;

for (const { file, label, fresh, stale } of sources) {
  test(`${label}: in-process cache rejects future at stamps (${file})`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(src, /import \{ isWsUpdatedAtFresh \} from "@\/lib\/ws\/timestamp-freshness"/);
    assert.match(src, fresh);
    assert.doesNotMatch(src, stale);
  });
}
