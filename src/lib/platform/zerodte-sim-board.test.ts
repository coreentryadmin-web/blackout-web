import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldServeSimBoard,
  isSimRequested,
  isZeroDteBoardPayload,
  emptySimBoardPayload,
  SIM_BOARD_SNAPSHOT_KEY,
  SIM_BOARD_TTL_SEC,
} from "./zerodte-sim-board";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── THE gate: {isAdmin, simRequested} → serve sim? ──────────────────────────────────
// This is the safety-critical truth table. Sim data reaches a browser ONLY on the one
// admin+sim combination; every other combination MUST fall through to the member path.
test("shouldServeSimBoard: sim served ONLY for admin AND sim=1", () => {
  assert.equal(shouldServeSimBoard(true, true), true, "admin + sim=1 → sim");
  assert.equal(shouldServeSimBoard(false, true), false, "non-admin + sim=1 → member (never sim)");
  assert.equal(shouldServeSimBoard(true, false), false, "admin + no sim → member");
  assert.equal(shouldServeSimBoard(false, false), false, "non-admin + no sim → member");
});

test("isSimRequested opts in ONLY on the exact ?sim=1 value", () => {
  assert.equal(isSimRequested("1"), true);
  assert.equal(isSimRequested(null), false);
  assert.equal(isSimRequested(undefined), false);
  assert.equal(isSimRequested("0"), false);
  assert.equal(isSimRequested("true"), false);
  assert.equal(isSimRequested("2"), false);
  assert.equal(isSimRequested(""), false);
});

// Composed gate exactly as the route uses it — proves a non-admin passing ?sim=1 never
// gets sim, and an admin without the param never gets sim.
test("composed gate: non-admin can never reach sim regardless of param", () => {
  for (const param of ["1", "0", "true", null, undefined, "", "yes"]) {
    assert.equal(shouldServeSimBoard(false, isSimRequested(param)), false);
  }
  assert.equal(shouldServeSimBoard(true, isSimRequested("1")), true);
  assert.equal(shouldServeSimBoard(true, isSimRequested("0")), false);
});

// ── Payload validation — malformed frames are rejected before any write ─────────────
test("isZeroDteBoardPayload accepts a valid empty payload", () => {
  assert.equal(isZeroDteBoardPayload(emptySimBoardPayload()), true);
});

test("isZeroDteBoardPayload rejects malformed frames", () => {
  assert.equal(isZeroDteBoardPayload(null), false);
  assert.equal(isZeroDteBoardPayload(undefined), false);
  assert.equal(isZeroDteBoardPayload("nope"), false);
  assert.equal(isZeroDteBoardPayload({}), false);
  assert.equal(isZeroDteBoardPayload({ available: false }), false, "available must be true");
  assert.equal(
    isZeroDteBoardPayload({ available: true, as_of: "not-a-date", session: {}, setups: [], ledger: [], covered_elsewhere: [], allocation: [] }),
    false,
    "as_of must be a parseable date"
  );
  const base = emptySimBoardPayload() as unknown as Record<string, unknown>;
  assert.equal(isZeroDteBoardPayload({ ...base, setups: "x" }), false, "setups must be an array");
  assert.equal(isZeroDteBoardPayload({ ...base, ledger: null }), false, "ledger must be an array");
  assert.equal(isZeroDteBoardPayload({ ...base, session: { date: "2026-07-25", trading_day: "yes", heat: {} } }), false, "trading_day must be boolean");
});

// ── Isolation invariants ────────────────────────────────────────────────────────────
test("sim key is isolated from the member snapshot key", () => {
  assert.equal(SIM_BOARD_SNAPSHOT_KEY, "zerodte:board:snapshot:sim:v1");
  assert.notEqual(SIM_BOARD_SNAPSHOT_KEY, "zerodte:board:snapshot:v1");
  // The sim module must never reference the member key literal.
  const src = readFileSync(join(ROOT, "lib/platform/zerodte-sim-board.ts"), "utf8");
  const memberKeyWrites = src.match(/"zerodte:board:snapshot:v1"/g) ?? [];
  assert.equal(memberKeyWrites.length, 0, "sim module must not reference the member key as a string literal");
});

test("sim TTL is short (self-expiring) and at least a minute", () => {
  assert.ok(SIM_BOARD_TTL_SEC >= 60, "TTL floor");
  assert.ok(SIM_BOARD_TTL_SEC <= 60 * 60, "TTL should be short (<= 1h) so abandoned sims self-expire");
});

// ── Route-level isolation proofs (read the shipped source) ─────────────────────────
test("board route serves member path unchanged and only branches to sim behind the gate", () => {
  const route = readFileSync(join(ROOT, "app/api/market/zerodte/board/route.ts"), "utf8");
  // The member derivation call is still present and unconditional as the default path.
  assert.match(route, /getZeroDteBoardPayload\(\)/);
  // Sim is gated on the admin check AND the param.
  assert.match(route, /shouldServeSimBoard/);
  assert.match(route, /isAdminUser/);
  assert.match(route, /getSimBoardPayload/);
});

test("ingest endpoint is admin-gated and writes ONLY the sim key", () => {
  const route = readFileSync(join(ROOT, "app/api/admin/zerodte/sim/board/route.ts"), "utf8");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /writeSimBoardSnapshot/);
  assert.match(route, /clearSimBoardSnapshot/);
  assert.match(route, /isZeroDteBoardPayload/);
  // The ingest endpoint must never call the member write path.
  assert.doesNotMatch(route, /refreshZeroDteBoardSnapshot/);
  assert.doesNotMatch(route, /buildAndPublishBoard/);
});
