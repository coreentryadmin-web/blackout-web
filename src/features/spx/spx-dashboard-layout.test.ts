import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SPX desk v3 (2026-07-13, member-directed consolidation): THREE panels —
 * intel rail | matrix | embedded SPX Vector chart (chart-only).
 * The Trade Alerts kanban (SpxTradeAlerts) and the Slayer desk terminal are REMOVED from the
 * flagship desk (components stay in the repo unused, one render away). NO terminal on SPX Slayer.
 *
 * Intel rail default (2026-07-26): the left column now mounts `SpxIntelRail`, which renders the
 * ⚡ Pulse event feed BY DEFAULT with a one-click toggle back to the original Largo commentary
 * rail. Largo is not removed — SpxIntelRail hosts both, so the narration is one toggle away.
 */
test("SpxDashboard mounts triple desk: intel rail (Pulse default + Largo toggle) | matrix | embedded Vector chart (no trade-alerts / terminal panels)", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");

  const banned = [
    "BenzingaNewsTicker",
    "BenzingaNewsRail",
    "SpxUnifiedTape",
    "SpxIntervalFlowPanel",
    "SpxIntelStrip",
    "SpxGexLadder",
    "SpxDarkPoolCard",
    "SpxDayPerformancePanel",
    "SpxTrackRecordPanel",
    "SpxStructureBlocks",
    "spx-left-stack",
    "spx-commentary-below-desk",
    // Desk v3 removals — must not be RENDERED (a comment pointing at the file is fine):
    "<SpxTradeAlerts",
    'import("./SpxTradeAlerts")',
    "SpxDeskTerminal",
    "spx-sniper-terminal-col",
    "spx-sniper-plays-col",
  ];

  for (const token of banned) {
    assert.equal(
      src.includes(token),
      false,
      `SpxDashboard must not mount ${token}`
    );
  }

  // Left column now mounts the intel-rail host (Pulse default), NOT SpxCommentaryRail directly.
  assert.match(src, /<SpxIntelRail/, "left column mounts SpxIntelRail");
  assert.equal(
    src.includes("<SpxCommentaryRail"),
    false,
    "Largo is reached via the SpxIntelRail toggle, not mounted directly in the dashboard"
  );
  assert.match(src, /spx-left-commentary/);
  assert.match(src, /SpxGexMatrixHeatmap/);
  assert.match(src, /spx-left-matrix/);
  assert.match(src, /SpxPlayVerdictBar/);
  assert.match(src, /spx-left-pin-stack/);
  assert.match(src, /spx-left-pin/);

  // Nothing is lost: SpxIntelRail renders the ⚡ Pulse rail by DEFAULT and keeps the original
  // Largo commentary rail one toggle away (default state = "pulse").
  const intel = readFileSync(join(process.cwd(), "src/features/spx/components/SpxIntelRail.tsx"), "utf8");
  assert.match(intel, /SpxPulseRail/, "intel rail renders the Pulse rail");
  assert.match(intel, /SpxCommentaryRail/, "intel rail keeps Largo reachable via the toggle");
  assert.match(intel, /useState<IntelMode>\("pulse"\)/, "Pulse is the default rail");
  // Declutter contract (user-directed 2026-07-14): the matrix column carries NO spot module
  // (spot lives in the header strip via StripSpot) and the session time bar is unrendered —
  // the Dealer Gamma Map owns the full column height.
  assert.equal(src.includes("spx-matrix-column-spot"), false, "matrix column must not mount the spot module");
  assert.equal(src.includes("<SpxSessionTimeBar"), false, "session time bar must not be rendered");
  // Focus toggle lives in the Vector toolbar, left of Replay, via the replay lead slot.
  assert.match(src, /toolbarReplayLeadSlot/);
  assert.match(src, /spx-desk-focus-btn/);
  // Embedded Vector chart column — client-hydrated via SpxVectorEmbed (no SSR seed blocking).
  assert.match(src, /SpxVectorEmbed/);
  assert.match(src, /spx-sniper-vector-col/);
  const embed = readFileSync(join(process.cwd(), "src/features/spx/components/SpxVectorEmbed.tsx"), "utf8");
  assert.match(embed, /embed="chart-only"/);
  assert.match(embed, /defaultDteHorizon="0dte"/);
  assert.match(embed, /defaultChartViewport="session"/);
  assert.match(embed, /defaultTimeframe=\{3\}/);
  assert.match(src, /spx-sniper-triple--desk-v3/);
  assert.match(src, /vector-page-toolbar/, "Vector toolbar portals full-width above the desk grid");
  assert.match(src, /toolbarPortalEl=\{vectorToolbarPortalEl\}/);
  assert.match(embed, /toolbarPortalEl/);
});

test("SpxDashboard: play poll + verdict bar gate on sessionActive (not resolveDeskLive)", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/components/SpxDashboard.tsx"), "utf8");
  assert.match(src, /useSpxPlay\(sessionActive\)/, "play SWR must not gate on brief live flicker");
  assert.equal(src.includes("playSessionActive"), false, "removed live&&desk gate that caused CLOSED flicker");
  assert.match(
    src,
    /SpxPlayVerdictBar[\s\S]*sessionActive=\{sessionActive\}/,
    "verdict bar must use sessionActive, not playSessionActive"
  );
});
