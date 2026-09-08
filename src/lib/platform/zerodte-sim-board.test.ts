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

test("isZeroDteBoardPayload rejects EVERY missing/mistyped load-bearing field individually", () => {
  const base = emptySimBoardPayload() as unknown as Record<string, unknown>;
  // session sub-shape.
  assert.equal(isZeroDteBoardPayload({ ...base, session: undefined }), false, "session required");
  assert.equal(isZeroDteBoardPayload({ ...base, session: "x" }), false, "session must be an object");
  assert.equal(isZeroDteBoardPayload({ ...base, session: { date: 20260725, trading_day: true, heat: {} } }), false, "date must be a string");
  assert.equal(isZeroDteBoardPayload({ ...base, session: { date: "2026-07-25", trading_day: true, heat: null } }), false, "heat must be an object");
  assert.equal(isZeroDteBoardPayload({ ...base, session: { date: "2026-07-25", trading_day: true } }), false, "heat required");
  // top-level arrays.
  assert.equal(isZeroDteBoardPayload({ ...base, covered_elsewhere: {} }), false, "covered_elsewhere must be an array");
  assert.equal(isZeroDteBoardPayload({ ...base, allocation: "x" }), false, "allocation must be an array");
  assert.equal(isZeroDteBoardPayload({ ...base, setups: undefined }), false, "setups must be an array");
});

test("isZeroDteBoardPayload accepts a fully-populated frame (ledger rows + populated arrays)", () => {
  const payload = {
    ...(emptySimBoardPayload() as unknown as Record<string, unknown>),
    setups: [{ ticker: "NVDA", score: 80, gate: { verdict: "WATCH" } }],
    ledger: [{ ticker: "NVDA", status: "OPEN", entry_premium: 2.0, last_mark: 2.1 }],
    covered_elsewhere: ["SPY"],
    allocation: [{ ticker: "NVDA", role: "PRIMARY", sizing: "FULL" }],
  };
  assert.equal(isZeroDteBoardPayload(payload), true);
});

test("isZeroDteBoardPayload: as_of must be a PARSEABLE date string, not just any string", () => {
  const base = emptySimBoardPayload() as unknown as Record<string, unknown>;
  assert.equal(isZeroDteBoardPayload({ ...base, as_of: "2026-07-25T10:00:00.000Z" }), true);
  assert.equal(isZeroDteBoardPayload({ ...base, as_of: "not-a-date" }), false);
  assert.equal(isZeroDteBoardPayload({ ...base, as_of: 1234567890 }), false, "as_of must be a string");
});

test("emptySimBoardPayload is available:true, governor null, and every collection empty", () => {
  const p = emptySimBoardPayload();
  assert.equal(p.available, true);
  assert.equal(p.governor, null);
  assert.deepEqual(p.setups, []);
  assert.deepEqual(p.ledger, []);
  assert.deepEqual(p.covered_elsewhere, []);
  assert.deepEqual(p.allocation, []);
  assert.equal(typeof p.session.heat, "object");
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

test("board route rounds member-visible floats at the API boundary (sim frames bypass zerodte-service)", () => {
  const route = readFileSync(join(ROOT, "app/api/market/zerodte/board/route.ts"), "utf8");
  assert.match(route, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(route, /roundFloats\(await getSimBoardPayload\(\)\)/);
  assert.match(route, /roundFloats\(await getZeroDteBoardPayload\(\)\)/);
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
