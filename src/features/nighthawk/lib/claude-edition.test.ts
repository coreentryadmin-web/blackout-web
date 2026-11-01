import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// generateEditionPlays() is async and calls fetchEditionChains() internally (live Polygon fan-out),
// so it cannot be driven end-to-end in this test environment without network/DB access -- same
// constraint edition-builder-scoring-snapshot.test.ts's own header documents for edition-builder.ts's
// import graph. Source-inspection is this codebase's established substitute for proving orchestration
// behavior in exactly this situation (see candidate-forward-grade.test.ts's own orchestration tests).

function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./claude-edition.ts", import.meta.url)), "utf8");
}

// ── Workstream C / #20's D4-extra (2026-09-21): the mainLoopRejectionCaptureEnabled() flag must
// gate ONLY whether mainLoopRejected is merged into stageRejected for durable capture -- it must
// never be read anywhere near detPlays/detFunnel, which are destructured directly from
// buildDeterministicEditionPlays' return and used unconditionally. ──────────────────────────────

test("generateEditionPlays: destructures mainLoopRejected from buildDeterministicEditionPlays alongside plays/funnel", () => {
  const src = readSource();
  assert.match(
    src,
    /let \{ plays: detPlays, funnel: detFunnel, mainLoopRejected \} = buildDeterministicEditionPlays\(/,
    "mainLoopRejected must come from the SAME destructure as detPlays/detFunnel, not a separate call"
  );
});

test("generateEditionPlays: mainLoopRejectionCaptureEnabled() gates ONLY the stageRejected merge, never detPlays/detFunnel", () => {
  const src = readSource();
  const flagCheckStart = src.indexOf("if (mainLoopRejectionCaptureEnabled())");
  assert.ok(flagCheckStart >= 0, "flag check not found");
  const flagBlock = src.slice(flagCheckStart, flagCheckStart + 150);

  assert.match(flagBlock, /stageRejected\.push\(\.\.\.mainLoopRejected\)/, "the ONLY effect of the flag must be merging mainLoopRejected into stageRejected");
  assert.doesNotMatch(flagBlock, /detPlays\s*=/, "the flag must never reassign detPlays");
  assert.doesNotMatch(flagBlock, /detFunnel\s*=/, "the flag must never reassign detFunnel");
});

test("generateEditionPlays: the flag check happens AFTER detPlays/detFunnel are already finalized from buildDeterministicEditionPlays and any rescue-play fallback", () => {
  const src = readSource();
  const detPlaysDestructureIdx = src.indexOf("let { plays: detPlays, funnel: detFunnel, mainLoopRejected }");
  const rescueBlockIdx = src.indexOf("buildRescuePlays({");
  const flagCheckIdx = src.indexOf("if (mainLoopRejectionCaptureEnabled())");
  assert.ok(detPlaysDestructureIdx >= 0 && rescueBlockIdx >= 0 && flagCheckIdx >= 0);
  assert.ok(detPlaysDestructureIdx < rescueBlockIdx, "synthesis must run before rescue");
  assert.ok(rescueBlockIdx < flagCheckIdx, "rescue fallback must run before the capture-flag check -- capture reflects the REAL synthesis attempt regardless of whether rescue later replaced detPlays");
});

test("mainLoopRejectionCaptureEnabled is imported from edition-quality, the same module every other NH_LEGACY_* flag in this file lives in", () => {
  const src = readSource();
  assert.match(src, /import \{ rescuePlaysEnabled, mainLoopRejectionCaptureEnabled \} from "\.\/edition-quality";/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-21, live repro MSTR score 52): buildRescuePlays sets
// gate_promoted:true on every play it returns (the whole point of the rescue path is bypassing
// normal geometry/premium/grounding gates), but its output used to be assigned to detPlays bare --
// never run through capGatePromotedConviction, the ONE gate_promoted construction site in the whole
// pipeline that skipped it (edition-builder.ts's critic-rescue and publish-gates.ts's
// promoteTopBlocked both cap). A rescue play could therefore surface an uncapped A/A+ conviction
// badge on a play that skipped every quality gate -- the exact over-trust risk the cap exists to
// prevent. Source-inspection per this file's established pattern (see the header comment above --
// generateEditionPlays can't be driven end-to-end here without live network/DB access).
test("generateEditionPlays: rescue plays are run through capGatePromotedConviction before replacing detPlays", () => {
  const src = readSource();
  assert.match(
    src,
    /detPlays = rescue\.map\(capGatePromotedConviction\)/,
    "rescue's output must be capped the same way every other gate_promoted construction site is -- a bare `detPlays = rescue` lets an uncapped A/A+ conviction leak through the one path that skips every quality gate"
  );
  assert.match(
    src,
    /import \{ capGatePromotedConviction \} from "\.\/publish-gates";/,
    "capGatePromotedConviction must come from publish-gates.ts, the one place this cap is defined"
  );
});
