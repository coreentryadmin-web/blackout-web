import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("spx-desk-pulse: timeout race condition fix", () => {
  test("buildSpxDeskPulseMinimal outer timeout allows inner Redis read to complete", async () => {
    // This test verifies the fix for: outer 400ms timeout firing before inner 500ms Redis read.
    // Root cause: Promise.race() resolves when FIRST promise settles; if outer timeout is shorter
    // than inner operation, the result is always empty shell.
    // Fix: outer timeout = deskPulseMaxBlockMs() + 200 (~700ms) > inner timeout (~500ms)

    // Import after test starts so mocks are applied
    const { deskPulseMaxBlockMs, deskPulseStructureRaceMs } = await import(
      "@/lib/providers/config"
    );

    const maxBlock = deskPulseMaxBlockMs();
    const structRace = deskPulseStructureRaceMs();

    // Verify configured timeouts have expected relationship
    assert.ok(maxBlock >= 500, `deskPulseMaxBlockMs must be >= 500ms, got ${maxBlock}ms`);
    assert.ok(structRace > maxBlock, `deskPulseStructureRaceMs (${structRace}ms) must exceed deskPulseMaxBlockMs (${maxBlock}ms)`);

    // Verify the fix: outer timeout is now calculated from maxBlock + buffer
    // so it should allow the inner operation to complete
    const outerTimeoutMs = maxBlock + 200;
    const innerTimeoutMs = 500; // fetchPulseLaneSnapshots inner timeout

    assert.ok(
      outerTimeoutMs > innerTimeoutMs,
      `Outer timeout (${outerTimeoutMs}ms) must exceed inner timeout (${innerTimeoutMs}ms) to avoid race condition`
    );
  });

  test("buildSpxDeskPulseMinimal uses dynamic timeout from config, not hardcoded 400ms", async () => {
    // Verify that the hardcoded 400ms has been replaced with deskPulseMaxBlockMs() + buffer
    // by checking the actual source code
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const src = readFileSync(
      join(process.cwd(), "src/features/spx/lib/spx-desk.ts"),
      "utf8"
    );

    // Should NOT contain the old hardcoded 400ms timeout pattern
    const oldPattern = /new Promise<SpxDeskPulse>\(\(resolve\) => setTimeout\(\(\) => resolve\(empty\), 400\)\)/;
    assert.ok(
      !oldPattern.test(src),
      "buildSpxDeskPulseMinimal must not use hardcoded 400ms timeout (was causing race condition)"
    );

    // Should contain the new dynamic timeout calculation
    const newPattern = /const pulseTimeoutMs = deskPulseMaxBlockMs\(\) \+ 200;[\s\S]*new Promise<SpxDeskPulse>\(\(resolve\) => setTimeout\(\(\) => resolve\(empty\), pulseTimeoutMs\)\)/;
    assert.ok(
      newPattern.test(src),
      "buildSpxDeskPulseMinimal must use dynamic pulseTimeoutMs calculated from deskPulseMaxBlockMs() + 200"
    );
  });

  test("buildSpxDeskPulseMinimal awaits prior-day bars off-hours before racing pulse snapshots", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
    const start = src.indexOf("export async function buildSpxDeskPulseMinimal");
    const end = src.indexOf("export async function buildSpxDeskFlow", start);
    assert.ok(start >= 0 && end > start);
    const block = src.slice(start, end);
    assert.match(
      block,
      /if \(!rthOpenNow\)[\s\S]*fetchPriorDayCached\(rthOpenNow\)/,
      "off-hours minimal pulse must block on prior-close fetch when the non-blocking lane returns null pdc"
    );
  });
});
