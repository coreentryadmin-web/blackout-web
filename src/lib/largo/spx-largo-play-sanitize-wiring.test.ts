import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

test("Largo SPX play surfaces use sanitizeSpxPlayPayloadForLargo", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  const convergence = readFileSync(join(ROOT, "src/lib/largo/spx-desk-convergence.ts"), "utf8");
  const ecosystem = readFileSync(join(ROOT, "src/lib/bie/ecosystem-context.ts"), "utf8");

  assert.match(runTool, /sanitizeSpxPlayPayloadForLargo\(await marketPlatform\.spx\.getSpxPlayState\(\)\)/);
  assert.match(convergence, /sanitizeSpxPlayPayloadForLargo\(rawPlay\)/);
  assert.match(ecosystem, /sanitizeSpxPlayPayloadForLargo\(spxFullState\)/);
});
