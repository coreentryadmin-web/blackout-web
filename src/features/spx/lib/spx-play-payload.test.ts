import test from "node:test";
import assert from "node:assert/strict";
import { confirmationsForAction, degradedPlayPayload, scanningPayload } from "./spx-play-payload";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxConfluence } from "./spx-signals";

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
