import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ladderFromGexStrikeExpiryCells } from "@/lib/providers/gex-strike-expiry-ladder";
import type { UwGexStrikeExpiryRow } from "@/lib/providers/unusual-whales";

/**
 * The desk's GEX walls must be read at the SAME expiry scope Polygon's walls are computed at.
 *
 * `getGexStrikeExpiryLadder(ticker)` with no allow-list sums EVERY stored expiry.
 * `gex-strike-expiry-ladder.ts` says what that costs, naming this index specifically:
 *
 *   > for SPX (where standard monthly/quarterly OpEx concentrates enormous OI on far strikes) the
 *   > two sides were answering different questions — producing hundreds of points of spurious
 *   > "divergence" against an internally-correct near-term Polygon computation
 *
 * `gex-positioning.ts` was fixed for exactly this and carries its own regression test. Three call
 * sites in `spx-desk.ts` were not, so the desk kept overlaying a whole-chain ladder onto
 * near-term-only Polygon levels and snapping the member-visible call/put wall to a far OpEx strike.
 * That is the same defect, on a surface the earlier fix's own comment names as a victim
 * ("the gex-positioning surface (desk terminal / Largo / Night's Watch)").
 *
 * The WS ladder here is built with the REAL production filter, so the only thing under test is
 * whether the desk PASSES the near-term allow-list through.
 */

mock.module("server-only", { namedExports: {} });

let wsLive = false;
let wsCells: Map<string, UwGexStrikeExpiryRow> = new Map();

// Relative specifier, not the `@/...` alias: `mock.module` keys the registry on the resolved file
// URL, and tsx resolves the source's alias import to this same path. Aliased here, the mock simply
// never matches — it fails as a missing module rather than as a silently ineffective mock.
mock.module("../../../lib/ws/uw-socket", {
  namedExports: {
    hasLiveGexStrikeExpiry: () => wsLive,
    getGexStrikeExpiryLadder: (_ticker: string, allowedExpiries?: readonly string[]) => {
      const { ladder, cell_count } = ladderFromGexStrikeExpiryCells(wsCells, allowedExpiries);
      if (ladder.size === 0) return null;
      return { ladder, updatedAt: Date.now(), cell_count };
    },
  },
});

let wsNearTermStrikeLevels: typeof import("./spx-desk").wsNearTermStrikeLevels;

before(async () => {
  ({ wsNearTermStrikeLevels } = await import("./spx-desk"));
});

const NEAR = "2026-08-21";
const FAR = "2026-09-19"; // standard monthly OpEx — where SPX parks its enormous far-strike OI

function wsRow(expiry: string, strike: number, net_gex: number): UwGexStrikeExpiryRow {
  return { ticker: "SPX", expiry, strike, net_gex } as UwGexStrikeExpiryRow;
}

/** Near-term walls ±50 of spot; far-OpEx walls ±500 of spot at 50× the magnitude. */
function seedMixedExpiryLadder() {
  wsCells = new Map([
    [`${NEAR}|6050`, wsRow(NEAR, 6050, 1_000_000)],
    [`${NEAR}|5950`, wsRow(NEAR, 5950, -1_000_000)],
    [`${FAR}|6500`, wsRow(FAR, 6500, 50_000_000)],
    [`${FAR}|5500`, wsRow(FAR, 5500, -50_000_000)],
  ]);
  wsLive = true;
}

const strikesOf = (levels: { strike: number }[] | null) =>
  (levels ?? []).map((l) => l.strike).sort((a, b) => a - b);

test("REGRESSION: the desk's WS ladder is scoped to near-term, not summed across all expiries", () => {
  seedMixedExpiryLadder();
  const levels = wsNearTermStrikeLevels([NEAR]);

  assert.deepEqual(
    strikesOf(levels),
    [5950, 6050],
    "far monthly OpEx strikes (5500/6500) must not reach the desk's wall ladder — they are 50x " +
      "larger, so an unscoped sum puts the member-visible wall ~500 points from spot"
  );
});

test("a wider near-term set legitimately admits more expiries — the scope is honoured, not hardcoded", () => {
  seedMixedExpiryLadder();
  assert.deepEqual(
    strikesOf(wsNearTermStrikeLevels([NEAR, FAR])),
    [5500, 5950, 6050, 6500],
    "the fix passes the caller's set through; it does not filter to a fixed horizon of its own"
  );
});

test("no near-term expiry set → NO override, fail closed to the Polygon levels", () => {
  // This is the case the two fallback paths hit before any successful matrix read has happened.
  // Returning the unscoped ladder there would be trading a missing answer for a known-wrong one;
  // the Polygon levels it would have replaced are already correctly scoped.
  seedMixedExpiryLadder();
  assert.equal(wsNearTermStrikeLevels(undefined), null);
  assert.equal(wsNearTermStrikeLevels([]), null);
});

test("WS channel idle → no override, even with cells still sitting in the store", () => {
  seedMixedExpiryLadder();
  wsLive = false;
  assert.equal(wsNearTermStrikeLevels([NEAR]), null);
});

test("a near-term set matching nothing in the ladder yields null, not an empty override", () => {
  seedMixedExpiryLadder();
  // An empty result must read as "no WS answer" so the caller keeps Polygon's levels, rather than
  // as an empty level list that would blank the desk's walls.
  assert.equal(wsNearTermStrikeLevels(["2026-01-01"]), null);
});

test("every getGexStrikeExpiryLadder call in spx-desk.ts passes an expiry scope", () => {
  // The unit tests above prove the helper is correct; this proves nothing bypasses it. Three
  // separate call sites had the bug — the canonical path, the sticky fallback, and the pulse fast
  // lane — so "fixed the one I found" is exactly the failure mode to guard against here.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

  const calls = [...src.matchAll(/getGexStrikeExpiryLadder\(([^)]*)\)/g)].map((m) => m[1]!.trim());
  assert.ok(calls.length > 0, "test is anchored to stale source — no call sites found");

  for (const args of calls) {
    assert.ok(
      args.includes(","),
      `getGexStrikeExpiryLadder(${args}) has no expiry allow-list. An unscoped ladder sums every ` +
        "expiry and snaps SPX's walls to far monthly OpEx — route it through wsNearTermStrikeLevels()."
    );
  }
});
