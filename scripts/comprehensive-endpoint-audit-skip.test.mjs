import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("comprehensive-endpoint-audit skips optional TikTok OAuth routes (503 when unconfigured)", () => {
  const src = readFileSync(new URL("./comprehensive-endpoint-audit.mjs", import.meta.url), "utf8");
  assert.match(src, /skipOAuth = new Set\(\[/);
  assert.match(src, /"\/api\/social\/tiktok\/connect"/);
  assert.match(src, /"\/api\/social\/tiktok\/callback"/);
});
