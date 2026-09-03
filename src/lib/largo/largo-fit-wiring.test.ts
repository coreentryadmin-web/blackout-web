import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

test("get_ecosystem_context fits at the Largo boundary only", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /fitEcosystemContextForModel\(raw\)\.fitted/);
  assert.doesNotMatch(
    readFileSync(join(ROOT, "src/lib/bie/ecosystem-context.ts"), "utf8"),
    /fitEcosystemContextForModel/
  );
});

test("get_cross_product_read includes SPX Slayer via get_spx_play", () => {
  const cross = readFileSync(join(ROOT, "src/lib/largo/contract/cross-product-read.ts"), "utf8");
  assert.match(cross, /get_spx_play/);
  assert.match(cross, /spxContribution/);
  assert.match(cross, /isSpxTicker/);
});

test("get_flow_tape fits at the Largo boundary only", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /fitFlowTapeForModel\(/);
});

test("get_postgres_flows and get_spx_engine_snapshots fit at the Largo boundary", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /fitPostgresFlowsForModel\(/);
  assert.match(runTool, /fitSpxEngineSnapshotsForModel\(/);
});

test("get_spx_play fits at the Largo boundary after confidence sanitize", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /sanitizeSpxPlayPayloadForLargo\(await marketPlatform\.spx\.getSpxPlayState\(\)\)/);
  assert.match(runTool, /fitSpxPlayForModel\(raw as Record<string, unknown>\)\.fitted/);
  assert.match(runTool, /case "get_spx_confluence":[\s\S]*fitSpxPlayForModel/);
});

test("get_signal_log and get_spx_voice_feed fit at the Largo boundary", () => {
  const runTool = readFileSync(join(ROOT, "src/lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /fitSpxSignalLogForModel\(/);
  assert.match(runTool, /fitSpxVoiceFeedForModel\(/);
});
