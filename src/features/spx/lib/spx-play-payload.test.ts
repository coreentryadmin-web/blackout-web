import test from "node:test";
import assert from "node:assert/strict";
import { confirmationsForAction, degradedPlayPayload, intelGates, scanningPayload } from "./spx-play-payload";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxConfluence } from "./spx-signals";
import type { PlayGateResult } from "./spx-play-gates";
import { categorizeGateBlocks, firstGateBlockCategory } from "./playbook-gate-categories";

const sampleConfirmations = {
  passed: true,
  passed_count: 7,
  total: 7,
  checks: [{ id: "flow", label: "Flow", passed: true }],
};

test("confirmationsForAction strips checks on SCANNING", () => {
  assert.equal(confirmationsForAction("SCANNING", sampleConfirmations), null);
});

test("confirmationsForAction keeps checks on WATCHING and BUY", () => {
  assert.equal(confirmationsForAction("WATCHING", sampleConfirmations), sampleConfirmations);
  assert.equal(confirmationsForAction("BUY", sampleConfirmations), sampleConfirmations);
});

test("degradedPlayPayload includes levels so UI never reads undefined.entry", () => {
  const payload = degradedPlayPayload();
  assert.equal(payload.action, "SCANNING");
  assert.equal(payload.phase, "SCANNING");
  assert.ok(payload.levels);
  assert.equal(payload.levels.entry, null);
  assert.equal(payload.gates.passed, false);
  assert.deepEqual(payload.gates.blocks, []);
});

// ---------------------------------------------------------------------------
// `assessed` — the flag that keeps a placeholder from being read as a grade.
// ---------------------------------------------------------------------------

function openDesk(): SpxDeskPayload {
  return {
    available: true,
    market_open: true,
    price: 5500,
    gamma_flip: 5490,
    max_pain: 5510,
    news_headlines: [],
    gex_walls: [],
    polled_at: new Date().toISOString(),
  } as SpxDeskPayload;
}

test("degradedPlayPayload marks itself unassessed — its D/0 are placeholders", () => {
  const payload = degradedPlayPayload();
  assert.equal(payload.assessed, false);
  // The literals are still there (the type is non-nullable and consumers index them freely);
  // `assessed` is what tells a reader they mean nothing.
  assert.equal(payload.grade, "D");
  assert.equal(payload.score, 0);
});

test("scanningPayload with NO confluence is unassessed even on an open desk", () => {
  // This is the live case the verdict bar was mis-rendering: computeSpxConfluence() returned null
  // mid-session, so `available` is true (the desk IS up) while nothing was actually graded.
  const payload = scanningPayload(openDesk(), null, "Scanning all lanes.");
  assert.equal(payload.available, true, "the desk is up — absence of a grade is not unavailability");
  assert.equal(payload.assessed, false);
  assert.equal(payload.grade, "D");
  assert.equal(payload.score, 0);
});

test("scanningPayload WITH a confluence is assessed and carries the real grade", () => {
  const confluence = {
    direction: "long",
    grade: "B+",
    score: 62,
    confidence: 0.7,
    factors: [],
    levels: { entry: 5500, stop: 5490, target: 5520, invalidation: "5485 break" },
  } as unknown as SpxConfluence;
  const payload = scanningPayload(openDesk(), confluence, "Building.");
  assert.equal(payload.assessed, true);
  assert.equal(payload.grade, "B+");
  assert.equal(payload.score, 62);
});

// ---------------------------------------------------------------------------
// intelGates — flat `blocks` vs `blocks_by_category` must stay in sync.
// ---------------------------------------------------------------------------

/**
 * Live repro, standing Ask Largo / 5-engine monitor (cycle 2026-10-09, GET /api/market/spx/play,
 * score 23/grade D/conflicts>=3, 0 DTE pre-market): spx-play-gates.ts's evaluatePlayGates()
 * computes `blocks_by_category`/`first_block_category` from the RAW (pre-humanization) blocks
 * list via categorizeGateBlocks(blocks) — see spx-play-gates.ts's PlayGateResult construction.
 * intelGates() then builds the user/Largo-facing `blocks` field by running humanizeGateBlocks()
 * over that SAME raw list, which (per the 2026-09-28 fix in spx-play-intel.ts) collapses any two
 * raw reasons that resolve to the same buildPlayIdeaIntel() line — e.g. "Grade D below minimum"
 * and "Score N too low — quality setups only" both become one idea line when a weak setup fails
 * both gates at once — but it reused the STALE `gates.blocks_by_category`/`gates.first_block_category`
 * verbatim rather than re-deriving them from the final, humanized+deduped list. Result: the flat
 * `blocks` array (what desk panel / Largo's get_spx_play primarily read) shows ONE collapsed idea
 * line, while `blocks_by_category.quality` still lists the two raw, pre-collapse strings as if they
 * were two independent reasons — the same double-counting bug the 2026-09-28 fix was supposed to
 * kill, just in the parallel categorized field nobody re-checked.
 */
function fixtureDeskAndConfluence(): { desk: SpxDeskPayload; confluence: SpxConfluence } {
  const desk = {
    price: 7765,
    vwap: 7780,
    above_vwap: false,
    gex_walls: [],
    levels: [],
  } as unknown as SpxDeskPayload;
  const confluence = {
    action: "WAIT",
    bias: "bullish",
    rawScore: 62,
    score: 23,
    headline: "",
    thesis: "",
    factors: [{ label: "GEX support", weight: 18, detail: "At 0DTE support node 7765 (+0 pts)" }],
    levels: { entry: 7765, stop: null, target: null, invalidation: "" },
    as_of: new Date().toISOString(),
    grade: "D",
    conflicts: 3,
    weighted_conflicts: 5,
    agreeing: 1,
    direction: "long",
  } as unknown as SpxConfluence;
  return { desk, confluence };
}

function rawGatesFixture(): PlayGateResult {
  const blocks = [
    "Tape's mixed — too many conflicting signals for clean entry",
    "Grade D below minimum (need B or better)",
    "Cold BUY needs score ≥78 (have 23) — WATCH→ENTRY path preferred",
    "Score 23 too low — quality setups only",
  ];
  // Exactly what evaluatePlayGates() in spx-play-gates.ts does today: categorize the RAW blocks.
  return {
    passed: false,
    blocks,
    blocks_by_category: categorizeGateBlocks(blocks),
    first_block_category: firstGateBlockCategory(blocks),
    warnings: [],
    entry_mode: "none",
    play_idea: null,
  };
}

test("intelGates: blocks_by_category must be re-derived from the FINAL humanized+deduped blocks, not the stale raw-block categorization", () => {
  const { desk, confluence } = fixtureDeskAndConfluence();
  const gates = rawGatesFixture();
  const out = intelGates(desk, confluence, gates);

  // The flat list already collapses the grade/score duplicate into one idea line (2026-09-28 fix).
  const ideaLines = out.blocks.filter((b) => /Tape's mixed, but/.test(b));
  assert.equal(ideaLines.length, 1, `expected one collapsed idea line in blocks, got: ${JSON.stringify(out.blocks)}`);

  // Every category entry must flatten back to the same final `blocks` set the consumer actually
  // sees — no stale raw duplicate ("Grade D below minimum" / "Score N too low") left behind.
  const allCategorized = [
    ...out.blocks_by_category.operational,
    ...out.blocks_by_category.risk,
    ...out.blocks_by_category.playbook_validity,
    ...out.blocks_by_category.quality,
  ];
  assert.deepEqual(
    [...allCategorized].sort(),
    [...out.blocks].sort(),
    `blocks_by_category must be a partition of the FINAL blocks list; categorized=${JSON.stringify(allCategorized)} vs blocks=${JSON.stringify(out.blocks)}`
  );
  assert.ok(
    !allCategorized.some((b) => b.includes("Grade D below minimum") || b.includes("too low — quality setups only")),
    `blocks_by_category must not still carry raw pre-humanization strings once blocks has collapsed them: ${JSON.stringify(allCategorized)}`
  );
});
