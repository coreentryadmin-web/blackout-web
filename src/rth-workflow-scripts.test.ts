import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const TOOL_AGENT_SCRIPTS = [
  "validate:tool-agent:spx-slayer",
  "validate:tool-agent:thermal",
  "validate:tool-agent:helix",
  "validate:tool-agent:largo",
  "validate:tool-agent:nighthawk",
  "validate:tool-agent:zerodte",
  "validate:tool-agent:vector",
];

test("rth-autonomous-open tool-agent matrix scripts exist in package.json", () => {
  for (const name of TOOL_AGENT_SCRIPTS) {
    assert.ok(pkg.scripts[name], `missing package.json script: ${name}`);
  }
});

test("validate:rth-continuous alias exists for rth-continuous-monitor workflow", () => {
  assert.ok(pkg.scripts["validate:rth-continuous"], "missing validate:rth-continuous");
  assert.match(pkg.scripts["validate:rth-continuous"], /validate:rth-live-monitor/);
});
