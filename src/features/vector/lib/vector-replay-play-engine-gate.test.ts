import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("Vector replay play-engine gate (Wave 2)", () => {
  it("VectorChart exposes onReplayModeChange and notifies on replay toggle", () => {
    const chart = read("src/features/vector/components/VectorChart.tsx");
    assert.match(chart, /onReplayModeChange\?: \(active: boolean\) => void;/);
    assert.match(chart, /onReplayModeChange\?\.\(replayMode\)/);
  });

  it("VectorPageShell pauses contract picks + live monitor during replay", () => {
    const shell = read("src/features/vector/components/VectorPageShell.tsx");
    assert.match(shell, /chartReplayMode/);
    assert.match(shell, /useVectorContractPicks\([\s\S]*chartReplayMode/);
    assert.match(shell, /useVectorPickLiveMonitor\([\s\S]*chartReplayMode/);
    assert.match(shell, /VectorReplayPlayGate/);
    assert.match(shell, /onReplayModeChange=\{handleReplayModeChange\}/);
  });

  it("useVectorContractPicks skips refresh when paused", () => {
    const hook = read("src/features/vector/lib/use-vector-contract-picks.ts");
    assert.match(hook, /paused = false/);
    assert.match(hook, /if \(paused\) \{\s*\n\s*setLoading\(false\)/);
  });

  it("useVectorPickLiveMonitor skips live poll when paused", () => {
    const hook = read("src/features/vector/lib/use-vector-pick-live-monitor.ts");
    assert.match(hook, /paused = false/);
    assert.match(hook, /if \(paused \|\| !emit\?\.play/);
  });
});
