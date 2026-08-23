import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTradeGovernor } from "./trade-governor";
import { evaluatePlaybookSessionRisk } from "./playbook-session-risk";
import { playbookStagingLabEnabled } from "./spx-play-config";
import { isStagingDeploy } from "@/lib/clerk-env";
import { liveDataQualityMode, playbookDataQualityFlags } from "./playbook-data-quality";
import type { SpxDeskPayload } from "./spx-desk";

// ---------------------------------------------------------------------------
// CHARACTERISATION, not aspiration.
//
// `playbookStagingLabEnabled()` is `isStagingDeploy()` wearing another name, and staging was
// decommissioned 2026-07-25, so every branch behind it is dead in every environment that exists.
// Two of those branches are DATA-QUALITY guards — they read like safeguards and are not running.
//
// These tests pin what production ACTUALLY does today so the behaviour is executable rather than
// only described in a comment. If someone re-predicates those guards (the open question in
// SLAYER-MAP §7.1), these tests fail — which is the point: the change should be deliberate and
// should update the record, not slip in as a quiet behaviour flip on a member-facing desk.
// ---------------------------------------------------------------------------

/** A desk that is SEVERELY degraded by `liveDataQualityMode`: 2+ of the three flags set. */
function severelyDegradedDesk(): SpxDeskPayload {
  return {
    vix: 16,
    halt_channel_stale: true,          // flag 1
    gex_walls: [],                     // flag 2 — gex_missing
    polled_at: new Date(Date.now() - 10 * 60_000).toISOString(), // flag 3 — desk_stale (>90s)
    as_of: new Date().toISOString(),
    price: 7674,
  } as unknown as SpxDeskPayload;
}

const CLEAN_SESSION = {
  last_buy_at: null,
  last_sell_at: null,
  last_sell_was_loss: false,
  last_direction: null,
  last_stop_at: null,
} as const;

test("the staging lab predicate is false here, exactly as it is in production", () => {
  // Guards the guard: if NEXT_PUBLIC_SITE_URL ever made this true, every assertion below would
  // pass vacuously for the wrong reason. Assert the premise before asserting the consequence.
  assert.equal(isStagingDeploy(), false);
  assert.equal(playbookStagingLabEnabled(), false);
});

test("the desk fixture really is SEVERE — the input to these tests is what it claims", () => {
  const flags = playbookDataQualityFlags(severelyDegradedDesk());
  assert.equal(flags.halt_channel_stale, true);
  assert.equal(flags.gex_missing, true);
  assert.equal(flags.desk_stale, true);
  assert.equal(liveDataQualityMode(flags), "severe");
});

test("evaluateTradeGovernor does NOT fail closed on severe data quality outside the staging lab", () => {
  // The block exists in trade-governor.ts and never runs. Severe data quality on a live BUY is
  // still caught — by spx-play-gates.ts:222, under playbookLiveGateEnabled(), which IS on in
  // production — so this is a redundant copy, not the load-bearing guard. Recorded so that nobody
  // cites the governor as the reason the desk is safe here.
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: severelyDegradedDesk(),
    session: { ...CLEAN_SESSION },
  });
  assert.equal(
    result.blocks.some((b) => b.toLowerCase().includes("data quality")),
    false,
    "the governor's data-quality block is staging-gated and must not fire here"
  );
  assert.notEqual(result.tier, "halt");
  assert.equal(result.emergency_shutdown, false);
});

test("degraded feeds do NOT reduce the governor's size multiplier outside the staging lab", () => {
  // This is the half with no live equivalent anywhere: the only branch that lowers
  // size_multiplier is staging-gated, AND playbook_size_multiplier (spx-play-gates.ts:496) has no
  // reader. Two independent breaks — fixing either alone changes nothing.
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: severelyDegradedDesk(),
    session: { ...CLEAN_SESSION },
  });
  assert.equal(result.size_multiplier, 1);
});

test("evaluatePlaybookSessionRisk leaves size at 1 on degraded feeds outside the staging lab", () => {
  const risk = evaluatePlaybookSessionRisk({
    playbook_id: "PB-01",
    triggers_today_by_pb: new Map(),
    desk: severelyDegradedDesk(),
  });
  assert.equal(risk.size_multiplier, 1);
  assert.equal(risk.block, null);
  assert.deepEqual(
    risk.warnings.filter((w) => w.includes("degraded")),
    [],
    "no degraded-size warning is emitted, because the branch that emits it never runs"
  );
});

test("the governor's NON-staging guards still fire on the same degraded desk", () => {
  // The desk above is severe AND carries VIX 34, which the governor blocks unconditionally.
  // Without this, the tests above could be passing because the governor is broken outright.
  const result = evaluateTradeGovernor({
    buy_intent: true,
    playbook_id: "PB-01",
    direction: "long",
    desk: { ...severelyDegradedDesk(), vix: 34 } as SpxDeskPayload,
    session: { ...CLEAN_SESSION },
  });
  assert.ok(result.blocks.some((b) => b.includes("VIX")), "VIX guard is not staging-gated");
});
