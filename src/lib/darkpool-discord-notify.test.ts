import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const moduleSrc = readFileSync(fileURLToPath(new URL("./darkpool-discord-notify.ts", import.meta.url)), "utf8");

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. claimDarkpoolDiscordPrint is a duplicate-post-tolerant dedup guard,
// so it must fail OPEN (post anyway) rather than let a transient Redis blip suppress a real print.
test("claimDarkpoolDiscordPrint fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    moduleSrc,
    /return sharedCacheSetNx\(seenKey\(print\), \{ at: new Date\(\)\.toISOString\(\) \}, SEEN_TTL_SEC\)\.catch\(\s*\(\) => true\s*\)/,
    "claimDarkpoolDiscordPrint must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
