import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CRONS = ["spx-evaluate", "spx-signal-observe", "market-regime-detector"] as const;

for (const cron of CRONS) {
  test(`${cron} wraps loadMergedSpxDesk in runWithBackgroundUwSweep`, () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), cron, "route.ts"),
      "utf8"
    );
    assert.match(
      src,
      /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
    );
    assert.match(
      src,
      /runWithBackgroundUwSweep\(\(\) => loadMergedSpxDesk\(\)\)/,
      "desk load must reserve a UW slot for live member traffic"
    );
  });
}
