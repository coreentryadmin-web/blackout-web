import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";

const ROOT = join(process.cwd(), "src/lib/largo");
const runTool = readFileSync(join(ROOT, "run-tool.ts"), "utf8");

const NEW_TOOLS = [
  "get_spx_desk_convergence",
  "get_spx_voice_feed",
  "get_spx_journal",
  "get_concept",
  "get_playbook_shadow_history",
  "get_discord_alert_history",
  "get_playbook_promotion_evidence",
] as const;

for (const tool of NEW_TOOLS) {
  test(`${tool} is registered and wired in run-tool`, () => {
    assert.ok(LARGO_TOOL_DEFS.some((d) => d.name === tool), `${tool} missing from LARGO_TOOL_DEFS`);
    assert.match(runTool, new RegExp(`case "${tool}"`));
  });
}
