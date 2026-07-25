// Unit tests for the PURE schema/sanity validators behind zerodte-e2e-suite.mjs.
// Mock payloads → verdict; NO network. Run: npx tsx --test scripts/audit/zerodte-e2e-suite.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// The validators are pure ESM with no type surface; import via the .mjs module.
import {
  asArray,
  checkMarketStatus,
  checkIndices,
  checkAggsPrev,
  checkAggsRange,
  checkGroupedDaily,
  checkOptionChainSnapshot,
  checkUnifiedSnapshot,
  checkReferenceContracts,
  checkV3Trades,
  checkBenzingaNews,
  checkFlowAlerts,
  checkTickerFlowAlerts,
  checkSpotExposuresStrike,
  checkGreekExposureStrike,
  checkScreenerStocks,
  checkDarkpool,
  checkNetFlowExpiry,
  checkEarnings,
  checkRdsInstance,
  checkRedisReplicationGroup,
  checkSnapshotFreshness,
  // @ts-expect-error — untyped .mjs sibling
} from "./lib/e2e-schema-checks.mjs";

test("asArray normalizes all three envelopes + bare array", () => {
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray({ results: [1] }), [1]);
  assert.deepEqual(asArray({ data: [2] }), [2]);
  assert.deepEqual(asArray({ chains: [3] }), [3]);
  assert.equal(asArray({ foo: 1 }), null);
  assert.equal(asArray(null), null);
});

test("marketstatus: pass with market+exchanges, RED without", () => {
  assert.equal(checkMarketStatus({ market: "closed", exchanges: { nyse: "closed" } }).pass, true);
  assert.equal(checkMarketStatus({ market: "open", exchanges: {} }).pass, true);
  assert.equal(checkMarketStatus({ exchanges: {} }).pass, false);
  assert.equal(checkMarketStatus({ market: "closed" }).pass, false);
  // Unexpected market value still passes but flags AMBER.
  assert.equal(checkMarketStatus({ market: "weird", exchanges: {} }).sanity, "AMBER");
});

test("indices: VIX plausibility band + SPX band enforced", () => {
  const good = { results: [{ ticker: "I:SPX", value: 7411.98 }, { ticker: "I:VIX", value: 18.6 }] };
  assert.equal(checkIndices(good).pass, true);
  // VIX out of band → RED.
  assert.equal(checkIndices({ results: [{ ticker: "I:SPX", value: 7400 }, { ticker: "I:VIX", value: 250 }] }).pass, false);
  // SPX implausible → RED.
  assert.equal(checkIndices({ results: [{ ticker: "I:SPX", value: 5 }, { ticker: "I:VIX", value: 18 }] }).pass, false);
  // Missing ticker → RED.
  assert.equal(checkIndices({ results: [{ ticker: "I:SPX", value: 7400 }] }).pass, false);
  // string values coerced.
  assert.equal(checkIndices({ results: [{ ticker: "I:SPX", value: "7400" }, { ticker: "I:VIX", value: "18" }] }).pass, true);
});

test("aggs prev + range", () => {
  assert.equal(checkAggsPrev({ results: [{ c: 738.9, h: 743, l: 737 }] }).pass, true);
  assert.equal(checkAggsPrev({ results: [{ c: 0 }] }).pass, false);
  assert.equal(checkAggsPrev({ results: [] }).pass, false);
  assert.equal(checkAggsPrev({ results: [{ c: 10, h: 1, l: 5 }] }).pass, false); // high<low
  assert.equal(checkAggsRange({ results: [{ o: 1, c: 2, h: 3, l: 0.5 }] }).pass, true);
  assert.equal(checkAggsRange({ results: [] }, { minBars: 1 }).pass, false);
  assert.equal(checkAggsRange({ results: [{ o: 1, c: 2, h: 3 }] }).pass, false); // missing l
});

test("grouped-daily: min-stock floor (~12k live, floor 8k)", () => {
  assert.equal(checkGroupedDaily({ resultsCount: 12410, results: [{ T: "AAPL", c: 200 }] }).pass, true);
  assert.equal(checkGroupedDaily({ resultsCount: 12410, results: [{ T: "AAPL", c: 200 }] }).detail, "12410 stocks");
  assert.equal(checkGroupedDaily({ resultsCount: 500, results: [{ T: "AAPL", c: 200 }] }).pass, false);
  assert.equal(checkGroupedDaily({ results: null }).pass, false);
  // resultsCount absent → falls back to length.
  const many = Array.from({ length: 9000 }, () => ({ T: "X", c: 1 }));
  assert.equal(checkGroupedDaily({ results: many }).pass, true);
});

test("option chain snapshot: greeks empty OK off-hours, AMBER during RTH", () => {
  const contract = { details: { ticker: "O:SPY260727C00500000", strike_price: 500 }, last_quote: { bid: 236.8, ask: 240.33 }, greeks: {} };
  // Off-hours: structural pass, sanity AMBER (empty greeks expected).
  const off = checkOptionChainSnapshot({ results: [contract] }, { rth: false });
  assert.equal(off.pass, true);
  assert.equal(off.sanity, "AMBER");
  // RTH with empty greeks: still pass (fail-closed handles it) but AMBER-flagged.
  const rth = checkOptionChainSnapshot({ results: [contract] }, { rth: true });
  assert.equal(rth.pass, true);
  assert.equal(rth.sanity, "AMBER");
  // RTH with populated greeks: GREEN.
  const live = checkOptionChainSnapshot({ results: [{ ...contract, greeks: { delta: 0.5, gamma: 0.01 } }] }, { rth: true });
  assert.equal(live.pass, true);
  assert.equal(live.sanity, "GREEN");
  // Missing last_quote → RED.
  assert.equal(checkOptionChainSnapshot({ results: [{ details: { ticker: "X", strike_price: 1 } }] }).pass, false);
  // Empty chain → RED.
  assert.equal(checkOptionChainSnapshot({ results: [] }).pass, false);
  // Unified snapshot shares the shape.
  assert.equal(checkUnifiedSnapshot({ results: [contract] }).pass, true);
  assert.equal(checkUnifiedSnapshot({ results: [] }).pass, false);
  // Unified /v3/snapshot carries the OCC at TOP LEVEL (`ticker`), details has no ticker.
  const unifiedShape = { ticker: "O:SPY260727C00500000", details: { strike_price: 500 }, last_quote: { bid: 236.8, ask: 240.33 }, greeks: {} };
  assert.equal(checkUnifiedSnapshot({ results: [unifiedShape] }).pass, true);
  assert.equal(checkOptionChainSnapshot({ results: [unifiedShape] }).pass, true);
});

test("reference contracts", () => {
  assert.equal(checkReferenceContracts({ results: [{ ticker: "O:SPY...", expiration_date: "2026-07-27", strike_price: 500 }] }).pass, true);
  assert.equal(checkReferenceContracts({ results: [{ ticker: "X" }] }).pass, false);
  assert.equal(checkReferenceContracts({ results: [] }).pass, false);
});

test("v3 trades: empty is AMBER-pass, populated needs price+ts", () => {
  assert.equal(checkV3Trades({ results: [] }).pass, true);
  assert.equal(checkV3Trades({ results: [] }).sanity, "AMBER");
  assert.equal(checkV3Trades({ results: [{ price: 238.5, sip_timestamp: 1784923918583263700 }] }).pass, true);
  assert.equal(checkV3Trades({ results: [{ size: 1 }] }).pass, false);
  assert.equal(checkV3Trades({ foo: 1 }).pass, false);
});

test("benzinga news", () => {
  assert.equal(checkBenzingaNews({ results: [{ title: "X" }] }).pass, true);
  assert.equal(checkBenzingaNews({ results: [] }).pass, true);
  assert.equal(checkBenzingaNews({ results: [{ author: "x" }] }).pass, false);
  assert.equal(checkBenzingaNews({}).pass, false);
});

test("UW flow-alerts: array required, thin is AMBER-pass", () => {
  assert.equal(checkFlowAlerts({ data: [{ total_premium: "257610" }] }).pass, true);
  assert.equal(checkFlowAlerts({ data: [] }).pass, true);
  assert.equal(checkFlowAlerts({ data: [] }).sanity, "AMBER");
  assert.equal(checkFlowAlerts({ foo: 1 }).pass, false);
  // has strike but no premium still structurally fine.
  assert.equal(checkFlowAlerts({ data: [{ strike: 500 }] }).pass, true);
});

test("UW GEX spot-exposures + greek-exposure need strike+gamma", () => {
  assert.equal(checkSpotExposuresStrike({ data: [{ strike: 7400, call_gamma_oi: 12 }] }).pass, true);
  assert.equal(checkSpotExposuresStrike({ data: [{ strike: 7400 }] }).pass, false); // no gamma
  assert.equal(checkSpotExposuresStrike({ data: [] }).pass, false);
  assert.equal(checkGreekExposureStrike({ data: [{ strike: 7400, call_gex: 1, put_gex: -1 }] }).pass, true);
  assert.equal(checkGreekExposureStrike({ data: [{ strike: 7400 }] }).pass, false);
});

test("UW screener/darkpool/net-flow/ticker-flow/earnings", () => {
  assert.equal(checkScreenerStocks({ data: [{ ticker: "NVDA" }] }).pass, true);
  assert.equal(checkScreenerStocks({ data: [{}] }).pass, false);
  assert.equal(checkDarkpool({ data: [{ price: 100, size: 5 }] }).pass, true);
  assert.equal(checkDarkpool({ data: [] }).pass, true);
  assert.equal(checkDarkpool({ data: [] }).sanity, "AMBER");
  assert.equal(checkDarkpool({ foo: 1 }).pass, false);
  assert.equal(checkNetFlowExpiry({ data: [{ moneyness: "atm" }] }).pass, true);
  assert.equal(checkTickerFlowAlerts({ data: [{ total_premium: "1" }] }).pass, true);
  assert.equal(checkTickerFlowAlerts({ foo: 1 }).pass, false);
  assert.equal(checkEarnings({ data: [{ symbol: "AAPL" }] }).pass, true);
  assert.equal(checkEarnings({ data: [] }).pass, true); // no reporters is valid
  assert.equal(checkEarnings({ data: [{}] }).pass, false);
});

test("RDS instance verdict: available + Multi-AZ", () => {
  const inst = { DBInstanceIdentifier: "blackout-production-postgres", DBInstanceStatus: "available", MultiAZ: true, Engine: "postgres", EngineVersion: "16.13" };
  assert.equal(checkRdsInstance(inst, { wantId: "blackout-production-postgres" }).pass, true);
  assert.match(checkRdsInstance(inst).detail, /Multi-AZ/);
  assert.equal(checkRdsInstance({ ...inst, DBInstanceStatus: "modifying" }).pass, false);
  assert.equal(checkRdsInstance({ ...inst, MultiAZ: false }).sanity, "AMBER");
  assert.equal(checkRdsInstance(inst, { wantId: "other" }).pass, false);
  assert.equal(checkRdsInstance(null).pass, false);
});

test("Redis replication-group verdict: available + failover", () => {
  const rg = { ReplicationGroupId: "blackout-production-redis-rg", Status: "available", AutomaticFailover: "enabled", MultiAZ: "enabled", MemberClusters: ["a", "b"] };
  const v = checkRedisReplicationGroup(rg, { wantId: "blackout-production-redis-rg" });
  assert.equal(v.pass, true);
  assert.match(v.detail, /2-node/);
  assert.match(v.detail, /failover on/);
  assert.equal(checkRedisReplicationGroup({ ...rg, Status: "creating" }).pass, false);
  assert.equal(checkRedisReplicationGroup({ ...rg, AutomaticFailover: "disabled" }).sanity, "AMBER");
  assert.equal(checkRedisReplicationGroup(null).pass, false);
});

test("snapshot freshness: fresh GREEN, RTH-stale AMBER, missing RED", () => {
  const now = 1_000_000;
  assert.equal(checkSnapshotFreshness(now - 3000, now, { rth: true }).pass, true);
  assert.equal(checkSnapshotFreshness(now - 3000, now, { rth: true }).sanity, "GREEN");
  // 10 min old during RTH → AMBER (cron lagging).
  assert.equal(checkSnapshotFreshness(now - 600_000, now, { rth: true }).sanity, "AMBER");
  // Same age off-hours → GREEN (SWR expected).
  assert.equal(checkSnapshotFreshness(now - 600_000, now, { rth: false }).sanity, "GREEN");
  // Small future skew (< 5s) tolerated as GREEN; large forward skew → AMBER.
  assert.equal(checkSnapshotFreshness(now + 1200, now, { rth: true }).sanity, "GREEN");
  assert.equal(checkSnapshotFreshness(now + 60_000, now, { rth: true }).sanity, "AMBER");
  // No timestamp → RED.
  assert.equal(checkSnapshotFreshness(null, now).pass, false);
});
