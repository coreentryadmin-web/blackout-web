/**
 * Tests for the 0DTE Level-1 snapshot replayer's PURE frame generation.
 * Runtime structural validation against the ZeroDteBoardPayload contract (mirrored in
 * assertValidBoardPayload) + the synthetic session's lifecycle invariants. No Redis, no
 * network, no DB. Run: `node --test scripts/audit/zerodte-sim-replay.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertSafeTarget,
  assertValidBoardPayload,
  buildSyntheticBoard,
  syntheticPlays,
  buildOcc,
  SIM_START_ET,
  SIM_END_ET,
  COMMIT_ET,
} from "./zerodte-sim-replay.mjs";

const SESSION = "2026-07-24"; // a Friday — trading day, deterministic
const EXPIRY = SESSION;
const plays = syntheticPlays(SESSION, EXPIRY);

test("every frame across the whole synthetic arc is a valid ZeroDteBoardPayload", () => {
  let checked = 0;
  for (let et = SIM_START_ET; et <= SIM_END_ET; et += 1) {
    const { payload } = buildSyntheticBoard(et, SESSION, plays);
    const errs = assertValidBoardPayload(payload);
    assert.equal(errs.length, 0, `et=${et} invalid: ${errs.join("; ")}`);
    checked++;
  }
  assert.ok(checked > 300, `expected the full RTH arc, checked ${checked}`);
});

test("pre-commit shows WATCH setups and an empty ledger; post-commit inverts", () => {
  const pre = buildSyntheticBoard(COMMIT_ET - 1, SESSION, plays).payload;
  assert.equal(pre.ledger.length, 0, "no ledger rows before 10:00");
  assert.equal(pre.setups.length, plays.length, "all plays are WATCH cards before 10:00");
  assert.ok(pre.setups.every((s) => s.gate && s.gate.verdict === "BLOCKED"), "WATCH cards are gate-BLOCKED (G-2)");

  const post = buildSyntheticBoard(COMMIT_ET, SESSION, plays).payload;
  assert.equal(post.setups.length, 0, "setups clear at commit (dedupe into ledger)");
  assert.equal(post.ledger.length, plays.length, "all plays committed into the ledger");
  assert.ok(post.ledger.every((r) => r.status === "OPEN"), "all rows OPEN at the commit instant");
});

test("lifecycle: each winner passes OPEN -> TRIM -> CLOSED-green; the loser stops -50", () => {
  // Late-session frame: everything is resolved.
  const end = buildSyntheticBoard(SIM_END_ET, SESSION, plays).payload;
  const byTicker = new Map(end.ledger.map((r) => [r.ticker, r]));

  const nvda = byTicker.get("NVDA");
  assert.equal(nvda.status, "CLOSED");
  assert.equal(nvda.closed_reason, "ratchet");
  assert.ok(nvda.live_pnl_pct > 50, `NVDA banked a big winner, got ${nvda.live_pnl_pct}`);

  const amd = byTicker.get("AMD");
  assert.equal(amd.status, "CLOSED");
  assert.equal(amd.closed_reason, "stopped");
  assert.equal(amd.live_pnl_pct, -50, "stopped loser pins to the -50% stop");
  assert.equal(amd.direction_hit, false);

  const spx = byTicker.get("SPX"); // the condor
  assert.equal(spx.closed_reason, "time_stop");
  assert.ok(spx.live_pnl_pct > 0, `condor kept credit (green), got ${spx.live_pnl_pct}`);

  // At least one row genuinely passes through TRIM mid-session.
  const mid = buildSyntheticBoard(700, SESSION, plays).payload;
  assert.ok(mid.ledger.some((r) => r.status === "TRIM"), "a runner is in TRIM mid-session");
});

test("marks map is emitted post-commit, keyed by a valid OCC, with a fresh ts", () => {
  const before = Date.now();
  const { marks } = buildSyntheticBoard(700, SESSION, plays);
  const occs = Object.keys(marks);
  assert.ok(occs.length >= 3, `expected several live marks, got ${occs.length}`);
  for (const occ of occs) {
    assert.match(occ, /^O:[A-Z]{1,6}\d{6}[CP]\d{8}$/, `OCC shape: ${occ}`);
    const m = marks[occ];
    assert.ok(typeof m.mark === "number" && m.mark > 0, "mark is a positive number");
    assert.ok(m.ts >= before, "ts is real wall-clock (freshness for getLiveOptionMark)");
    assert.ok(m.bid <= m.mark && m.mark <= m.ask, "bid <= mark <= ask");
  }
});

test("buildOcc matches the app's SPX->SPXW + 8-digit-strike convention", () => {
  assert.equal(buildOcc("SPX", "2026-07-24", "call", 5850), "O:SPXW260724C05850000");
  assert.equal(buildOcc("NVDA", "2026-07-24", "call", 182), "O:NVDA260724C00182000");
  assert.equal(buildOcc("AMD", "2026-07-24", "put", 168), "O:AMD260724P00168000");
});

test("assertValidBoardPayload rejects a malformed payload", () => {
  const good = buildSyntheticBoard(700, SESSION, plays).payload;
  assert.equal(assertValidBoardPayload(good).length, 0);
  // Corrupt a required field -> must be caught.
  const bad = JSON.parse(JSON.stringify(good));
  bad.ledger[0].live_pnl_pct = "not-a-number";
  assert.ok(assertValidBoardPayload(bad).length > 0, "invalid live_pnl_pct is caught");
  const bad2 = JSON.parse(JSON.stringify(good));
  delete bad2.setups;
  assert.ok(assertValidBoardPayload(bad2).length > 0, "missing setups[] is caught");
});

// ── The safety refusal ───────────────────────────────────────────────────────────────
// Regression cover for the phantom-guard sweep (2026-08-21): the documented refusal
// ("REFUSES to run against a Redis that already holds a live-looking board snapshot NOT
// written by this tool") existed as assertSafeTarget() but was wired to the PUBLISH path
// only. `--reset --redis=<prod>` therefore deleted the live board snapshot and every
// nw:optmark:* key with no refusal and no --force. These tests pin the guard's behaviour
// AND the fact that the reset path is routed through it.

/** Minimal ioredis stand-in: only .get() is reached by assertSafeTarget. */
function fakeRedis(map) {
  return { get: async (k) => (k in map ? map[k] : null) };
}
const PREFIX = "blackout:";
const BOARD = `${PREFIX}zerodte:board:snapshot:v1`;
const MARKER = `${PREFIX}zerodte:sim:marker:v1`;
const liveSnap = JSON.stringify({
  available: true,
  as_of: new Date().toISOString(),
  ledger: [{ ticker: "SPX" }],
  setups: [],
});

test("assertSafeTarget refuses a live-looking foreign snapshot", async () => {
  await assert.rejects(
    () => assertSafeTarget(fakeRedis({ [BOARD]: liveSnap }), PREFIX, false),
    /REFUSING/,
    "a live-looking snapshot with no sim marker must be refused"
  );
});

test("assertSafeTarget allows our own marked snapshot, an empty target, and --force", async () => {
  // our own sim snapshot — the marker proves we wrote it
  await assertSafeTarget(fakeRedis({ [BOARD]: liveSnap, [MARKER]: '{"sim":true}' }), PREFIX, false);
  // nothing there at all
  await assertSafeTarget(fakeRedis({}), PREFIX, false);
  // explicit operator override
  await assertSafeTarget(fakeRedis({ [BOARD]: liveSnap }), PREFIX, true);
});

test("assertSafeTarget treats an unparseable present snapshot as foreign", async () => {
  await assert.rejects(
    () => assertSafeTarget(fakeRedis({ [BOARD]: "{not json" }), PREFIX, false),
    /REFUSING/,
    "unparseable-but-present must be conservative, not permissive"
  );
});

test("the --reset path is routed through assertSafeTarget", async () => {
  // Source-level assertion: the guard is only useful if the destructive branch calls it.
  // A behavioural test would need a live Redis; this pins the wiring that was missing.
  const src = await readFile(new URL("./zerodte-sim-replay.mjs", import.meta.url), "utf8");
  const resetBlock = src.slice(src.indexOf("if (args.reset) {"), src.indexOf("const n = await resetKeys("));
  assert.match(
    resetBlock,
    /assertSafeTarget\(client, args\.keyPrefix, args\.force\)/,
    "--reset must call assertSafeTarget BEFORE resetKeys(); without it, pointing --reset at a " +
      "prod Redis silently deletes the live board snapshot"
  );
});
