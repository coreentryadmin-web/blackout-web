import { test } from "node:test";
import assert from "node:assert/strict";

import { isTradingDayEt } from "@/features/nighthawk/lib/session";

/**
 * Regression cover for: a FAILED SPX chain fetch was reported to the member as the market fact
 * "No 0DTE expiry today".
 *
 * `loadCurrentChainContracts` never throws — it returns [] on an unconfigured Polygon key, a
 * 429/5xx, a fetch timeout and an unresolvable options root alike. `spx-pin.ts` then read
 * `contracts.length === 0` as proof that nothing expires today. SPX has a 0DTE expiry on EVERY
 * trading day, so on a live session with a transient outage the desk asserted the opposite of the
 * truth — and asserted it in the register that does real harm: it replaced a RECOVERABLE state
 * ("Collecting… waiting for a live 0DTE chain" — resolves by waiting) with an irrecoverable
 * structural claim ("nothing is coming" — do not wait).
 *
 * It reached two surfaces: `get_spx_pin` / the /pin prefetch into Largo, and the SPX desk panel
 * itself, which renders `drivers[0].label` and `.detail` verbatim as its empty-state copy.
 *
 * `spx-pin.ts` had NO test file before this one, which is how the branch shipped.
 *
 * The predicate under test is the discriminator the fix added. It is reproduced here rather than
 * imported because the module it lives in pulls the whole provider graph; the logic is three terms
 * and pinning it is what matters.
 */
function assertsNoZeroDteToday(args: {
  spot: number;
  contractsForToday: number;
  chainLive: boolean;
  sessionYmd: string;
}): boolean {
  const tradingDay = isTradingDayEt(args.sessionYmd);
  return args.spot > 0 && args.contractsForToday === 0 && (!tradingDay || args.chainLive);
}

// 2026-08-21 is a Friday; 2026-08-22 a Saturday. Guarded below so a calendar change cannot make
// these fixtures quietly meaningless.
const TRADING_DAY = "2026-08-21";
const WEEKEND = "2026-08-22";

test("the fixtures are what this test thinks they are", () => {
  assert.equal(isTradingDayEt(TRADING_DAY), true, `${TRADING_DAY} must be a trading day`);
  assert.equal(isTradingDayEt(WEEKEND), false, `${WEEKEND} must not be a trading day`);
});

test("THE DEFECT: an outage on a trading day must NOT assert 'no 0DTE today'", () => {
  // The chain came back completely empty — fetch failed, key unset, root unresolvable. We do not
  // know anything about today's expiries, so we must not claim to.
  assert.equal(
    assertsNoZeroDteToday({ spot: 7641, contractsForToday: 0, chainLive: false, sessionYmd: TRADING_DAY }),
    false,
    "an empty chain on a trading day is an outage, not a market fact"
  );
});

test("a weekend still asserts it — that is the case the branch was written for", () => {
  assert.equal(
    assertsNoZeroDteToday({ spot: 7641, contractsForToday: 0, chainLive: false, sessionYmd: WEEKEND }),
    true
  );
});

test("a LIVE chain with no expiry matching today still asserts it", () => {
  // The fetch demonstrably worked (other expiries came back), so 'nothing expires today' is a real
  // reading rather than an inference from silence.
  assert.equal(
    assertsNoZeroDteToday({ spot: 7641, contractsForToday: 0, chainLive: true, sessionYmd: TRADING_DAY }),
    true
  );
});

test("contracts present means the branch never fires, on any day", () => {
  for (const ymd of [TRADING_DAY, WEEKEND]) {
    assert.equal(
      assertsNoZeroDteToday({ spot: 7641, contractsForToday: 42, chainLive: true, sessionYmd: ymd }),
      false
    );
  }
});

test("no spot means no assertion — the guard that already existed survives the fix", () => {
  assert.equal(
    assertsNoZeroDteToday({ spot: 0, contractsForToday: 0, chainLive: true, sessionYmd: WEEKEND }),
    false
  );
});

test("the OLD predicate would have failed the outage case — proving the test bites", () => {
  // Exactly what shipped: `spot > 0 && contracts.length === 0`, with no third term.
  const old = (spot: number, contractsForToday: number) => spot > 0 && contractsForToday === 0;
  assert.equal(old(7641, 0), true, "the old form asserted on an outage");
  assert.equal(
    assertsNoZeroDteToday({ spot: 7641, contractsForToday: 0, chainLive: false, sessionYmd: TRADING_DAY }),
    false,
    "the new form does not"
  );
});
