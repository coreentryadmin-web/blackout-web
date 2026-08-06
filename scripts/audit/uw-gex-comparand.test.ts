// Unit tests for the PURE comparand/verdict helpers behind data-validator.mjs's
// `net_gex SIGN` check. Mock payloads → verdict; NO network.
// Run: npx tsx --test scripts/audit/uw-gex-comparand.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UW_INTRADAY_GAMMA_KEYS,
  netGexSignVerdict,
  pickUwIntradayGamma,
} from "./lib/uw-gex-comparand.mjs";

/** Shape of one UW /spot-exposures minute row (the fields this check reads). */
const minute = (time: string, gammaOi: number | null, extra: Record<string, unknown> = {}) => ({
  time,
  ...(gammaOi === null ? {} : { gamma_per_one_percent_move_oi: gammaOi }),
  ...extra,
});

test("picks the LAST row — UW returns these minute series ascending", () => {
  const p = pickUwIntradayGamma({
    data: [minute("09:30:00", 1e9), minute("09:31:00", 2e9), minute("15:59:00", -5.62e8)],
  });
  assert.equal(p.ok, true);
  assert.equal(p.value, -5.62e8);
  assert.equal(p.time, "15:59:00");
  assert.equal(p.key, "gamma_per_one_percent_move_oi");
});

test("prefers the OI variant, falls back through dir/vol", () => {
  assert.equal(
    pickUwIntradayGamma({
      data: [minute("15:59:00", 3e9, { gamma_per_one_percent_move_dir: -1e9 })],
    }).key,
    "gamma_per_one_percent_move_oi"
  );
  const fallback = pickUwIntradayGamma({
    data: [minute("15:59:00", null, { gamma_per_one_percent_move_dir: -1e9 })],
  });
  assert.equal(fallback.key, "gamma_per_one_percent_move_dir");
  assert.equal(fallback.value, -1e9);
  const vol = pickUwIntradayGamma({
    data: [minute("15:59:00", null, { gamma_per_one_percent_move_vol: 7e8 })],
  });
  assert.equal(vol.key, "gamma_per_one_percent_move_vol");
});

test("numeric strings are accepted; non-finite/absent values are not", () => {
  assert.equal(pickUwIntradayGamma({ data: [minute("t", null, { gamma_per_one_percent_move_oi: "-1234.5" })] }).value, -1234.5);
  for (const bad of [null, undefined, "", "abc", NaN, Infinity]) {
    const r = pickUwIntradayGamma({ data: [{ time: "t", gamma_per_one_percent_move_oi: bad }] });
    assert.equal(r.ok, false, `expected reject for ${String(bad)}`);
  }
});

test("empty / malformed payloads report no-data instead of throwing", () => {
  for (const bad of [null, undefined, {}, { data: null }, { data: [] }, { data: [null] }, { data: [[1, 2]] }, "nope"]) {
    const r = pickUwIntradayGamma(bad as never);
    assert.equal(r.ok, false);
  }
  assert.equal(pickUwIntradayGamma({ data: [] }).reason, "no-data");
});

test("a provider field rename surfaces as no-gamma-field, never a fabricated comparison", () => {
  const r = pickUwIntradayGamma({ data: [{ time: "t", gamma_1pct_oi: 1e9, price: 640 }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-gamma-field");
  assert.match(r.keysSeen!, /gamma_1pct_oi/);
  // …and the verdict downgrades to INFO (a skipped check), not a PASS or a WARN.
  const v = netGexSignVerdict(1e9, r);
  assert.equal(v.status, "INFO");
  assert.match(v.detail, /gamma_per_one_percent_move_oi/);
});

test("keys the helper looks for are the documented per-1%-move family", () => {
  assert.deepEqual([...UW_INTRADAY_GAMMA_KEYS], [
    "gamma_per_one_percent_move_oi",
    "gamma_per_one_percent_move_dir",
    "gamma_per_one_percent_move_vol",
  ]);
});

// ── verdict ────────────────────────────────────────────────────────────────────────

test("agreeing signs PASS and report the magnitude ratio", () => {
  const v = netGexSignVerdict(1.7e9, pickUwIntradayGamma({ data: [minute("15:59:00", 1.5e9)] }));
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /ratio=1\.13×/);
  assert.match(v.detail, /@15:59:00/);
});

test("genuinely opposite signs still WARN — the check must retain teeth", () => {
  assert.equal(netGexSignVerdict(-5.62e8, pickUwIntradayGamma({ data: [minute("t", 1.5e9)] })).status, "WARN");
  assert.equal(netGexSignVerdict(1.7e9, pickUwIntradayGamma({ data: [minute("t", -1.5e9)] })).status, "WARN");
});

test("REGRESSION: a net-short-gamma session no longer WARNs against an intraday comparand", () => {
  // The 4 WARNing runs of 2026-08-06 (archived audit-output/validation-2026-08-06T*.json).
  // Old comparand: the DAILY greek-exposure aggregate, frozen at +560326 all session — so every
  // negative app value tripped the check. New comparand: the same minute's UW spot gamma, which
  // is negative too when dealers are actually short gamma → PASS.
  const appNetGexWhenWarned = [-334510745.28, -116185819.5, -410991357.79, -562298872.8];
  for (const app of appNetGexWhenWarned) {
    const dailyStyle = netGexSignVerdict(app, { ok: true, key: "daily", value: 560326, time: null } as never);
    assert.equal(dailyStyle.status, "WARN", "the old daily comparand is what produced the false WARN");
    const intraday = netGexSignVerdict(app, pickUwIntradayGamma({ data: [minute("t", -8.4e8)] }));
    assert.equal(intraday.status, "PASS", `app=${app} should agree with a net-short intraday comparand`);
  }
});

test("zero comparand reports ratio n/a instead of Infinity", () => {
  const v = netGexSignVerdict(1.7e9, pickUwIntradayGamma({ data: [minute("t", 0)] }));
  assert.match(v.detail, /ratio=n\/a/);
  assert.equal(v.status, "PASS"); // 0 >= 0
});

test("absent app net_gex or empty UW payload skip as INFO, never a false PASS", () => {
  assert.equal(netGexSignVerdict(null, pickUwIntradayGamma({ data: [minute("t", 1e9)] })).status, "INFO");
  assert.equal(netGexSignVerdict(NaN, pickUwIntradayGamma({ data: [minute("t", 1e9)] })).status, "INFO");
  assert.equal(netGexSignVerdict(1e9, pickUwIntradayGamma({ data: [] })).status, "INFO");
});
