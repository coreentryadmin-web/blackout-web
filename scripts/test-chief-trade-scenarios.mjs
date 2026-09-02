#!/usr/bin/env node
/**
 * Full Chief Trade Alert Bot scenario suite — unit + live API.
 * Run: node --import tsx scripts/test-chief-trade-scenarios.mjs
 */
import { execSync } from "node:child_process";
import {
  buildLegacyTradePayload,
  legacyChiefTradeChannelId,
} from "../src/features/nighthawk/lib/legacy-discord-trade-notify.ts";
import {
  buildZeroDteTradePayload,
  chiefTradeVirtualLots,
  formatZeroDteExpiry,
  formatZeroDteStrike,
} from "../src/lib/zerodte/discord-trade-notify.ts";

const BOT_URL = "https://chief-trade-alert-bot-production.up.railway.app";
const SESSION = `e2e-suite-${Date.now()}`;

const results = [];

function rec(scenario, status, detail = "") {
  results.push({ scenario, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "SKIP" ? "○" : "⚠";
  console.log(`${icon} ${scenario}: ${status}${detail ? ` — ${detail}` : ""}`);
}

function getSecret() {
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" }
  );
  return JSON.parse(raw).CHIEF_TRADE_API_SECRET;
}

async function api(path, opts = {}) {
  const res = await fetch(`${BOT_URL}${path}`, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

async function trade(secret, payload) {
  return api("/api/trade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ author_name: "Night-Hawk-Bot", ...payload }),
  });
}

// ── Unit: payload builders ────────────────────────────────────────────────────
function testPayloadBuilders() {
  console.log("\n── Payload builders (unit) ──");

  rec("formatZeroDteExpiry", formatZeroDteExpiry("2026-09-02") === "9/2" ? "PASS" : "FAIL");
  rec("formatZeroDteStrike long→C", formatZeroDteStrike(7650, "long") === "7650C" ? "PASS" : "FAIL");
  rec("formatZeroDteStrike short→P", formatZeroDteStrike(180, "short") === "180P" ? "PASS" : "FAIL");

  const open1 = buildZeroDteTradePayload(
    { session_date: "2026-09-02", ticker: "SPX", direction: "long", top_strike: 7650, expiry: "2026-09-02", entry_premium: 3.55 },
    "BTO",
    3.55
  );
  rec("BTO default qty=1", open1?.qty === 1 && open1?.strike === "7650C" ? "PASS" : "FAIL", JSON.stringify(open1));

  const prev = process.env.CHIEF_TRADE_VIRTUAL_LOTS;
  process.env.CHIEF_TRADE_VIRTUAL_LOTS = "3";
  const open3 = buildZeroDteTradePayload(
    { session_date: "2026-09-02", ticker: "SPX", direction: "long", top_strike: 7650, expiry: "2026-09-02", entry_premium: 3.55 },
    "BTO",
    3.55
  );
  const closeAfter2Trims = buildZeroDteTradePayload(
    { session_date: "2026-09-02", ticker: "SPX", direction: "long", top_strike: 7650, expiry: "2026-09-02", entry_premium: 3.55, trims_taken: 2 },
    "STC",
    5.1,
    { idempotencySuffix: "stc" }
  );
  const trim1 = buildZeroDteTradePayload(
    { session_date: "2026-09-02", ticker: "SPX", direction: "long", top_strike: 7650, expiry: "2026-09-02", entry_premium: 3.55 },
    "STC",
    4.2,
    { qty: 1, idempotencySuffix: "trim:1" }
  );
  if (prev === undefined) delete process.env.CHIEF_TRADE_VIRTUAL_LOTS;
  else process.env.CHIEF_TRADE_VIRTUAL_LOTS = prev;

  rec("BTO virtual lots=3 → qty 3", open3?.qty === 3 ? "PASS" : "FAIL", `qty=${open3?.qty}`);
  rec("STC trim partial qty=1", trim1?.qty === 1 && trim1?.idempotency_key?.includes("trim:1") ? "PASS" : "FAIL");
  rec("STC close after 2 trims → qty 1", closeAfter2Trims?.qty === 1 ? "PASS" : "FAIL", `qty=${closeAfter2Trims?.qty}`);

  const condor = buildZeroDteTradePayload(
    { session_date: "2026-09-02", ticker: "SPY", direction: "long", top_strike: 500, expiry: "2026-09-02", entry_premium: 1.2, play_type: "CONDOR" },
    "BTO",
    1.2
  );
  rec("CONDOR skipped (null payload)", condor === null ? "PASS" : "FAIL");

  rec("chiefTradeVirtualLots default", chiefTradeVirtualLots() === 1 ? "PASS" : "FAIL", String(chiefTradeVirtualLots()));

  const prevCh = process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
  process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID = "1544793338597871636";
  const legacyOpen = buildLegacyTradePayload(
    { edition_for: "2026-09-02", ticker: "MRNA", direction: "long", top_strike: 155, expiry: "2026-09-04", entry_premium: 5.28 },
    "BTO",
    5.28
  );
  if (prevCh === undefined) delete process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID;
  else process.env.LEGACY_CHIEF_TRADE_CHANNEL_ID = prevCh;
  rec(
    "Legacy payload channel + author",
    legacyOpen?.channel_id === "1544793338597871636" && legacyOpen?.author_name === "night-hawk-legacy" ? "PASS" : "FAIL",
    JSON.stringify({ channel: legacyOpen?.channel_id, author: legacyOpen?.author_name })
  );
  rec("legacyChiefTradeChannelId env", legacyChiefTradeChannelId() == null ? "PASS" : "SKIP", "unset in unit env");
}

// ── Live API ─────────────────────────────────────────────────────────────────
async function testLiveApi(secret) {
  console.log("\n── Live API (Railway) ──");

  const health = await api("/health");
  rec("GET /health", health.status === 200 && health.body?.bot_ready === true ? "PASS" : "FAIL", JSON.stringify(health.body));

  const noAuth = await trade(secret.replace(/./g, "x"), { action: "BTO", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 1 });
  rec("auth bad bearer → 401", noAuth.status === 401 ? "PASS" : "FAIL", `HTTP ${noAuth.status}`);

  const noBearer = await api("/api/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "BTO", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 1 }),
  });
  rec("auth missing bearer → 401", noBearer.status === 401 ? "PASS" : "FAIL", `HTTP ${noBearer.status}`);

  // ── Scenario 1: default 1-lot open → duplicate → close ──
  const k1 = `${SESSION}:1lot`;
  const bto1 = await trade(secret, { action: "BTO", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 3.2, idempotency_key: `${k1}:bto` });
  rec("1-lot BTO open", bto1.status === 200 && bto1.body?.ok ? "PASS" : "FAIL", `msg=${bto1.body?.message_id ?? bto1.body?.detail}`);

  const dup = await trade(secret, { action: "BTO", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 3.2, idempotency_key: `${k1}:bto` });
  rec("idempotency duplicate BTO", dup.status === 200 && dup.body?.duplicate === true ? "PASS" : "FAIL", JSON.stringify(dup.body));

  const stc1 = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 3.8, idempotency_key: `${k1}:stc` });
  rec("1-lot STC close", stc1.status === 200 && stc1.body?.ok ? "PASS" : "FAIL", `msg=${stc1.body?.message_id ?? stc1.body?.detail}`);

  const stcNoPos = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7660C", expiry: "9/2", price: 3.8, idempotency_key: `${k1}:stc-again` });
  rec("STC no open position → error", stcNoPos.status === 400 || stcNoPos.body?.detail ? "PASS" : "FAIL", String(stcNoPos.body?.detail ?? stcNoPos.status));

  // ── Scenario 2: 3-lot trim_scale (BTO×3, trim×2, close×1) ──
  const k2 = `${SESSION}:3lot`;
  const bto3 = await trade(secret, { action: "BTO", qty: 3, ticker: "SPX", strike: "7665C", expiry: "9/2", price: 2.5, idempotency_key: `${k2}:bto` });
  rec("3-lot BTO open (×3)", bto3.status === 200 && bto3.body?.ok ? "PASS" : "FAIL", `msg=${bto3.body?.message_id}`);

  const trim1 = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7665C", expiry: "9/2", price: 3.0, idempotency_key: `${k2}:trim:1` });
  rec("3-lot trim bank #1 (STC×1)", trim1.status === 200 && trim1.body?.ok ? "PASS" : "FAIL", `msg=${trim1.body?.message_id}`);

  const trim2 = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7665C", expiry: "9/2", price: 3.4, idempotency_key: `${k2}:trim:2` });
  rec("3-lot trim bank #2 (STC×1)", trim2.status === 200 && trim2.body?.ok ? "PASS" : "FAIL", `msg=${trim2.body?.message_id}`);

  const closeRem = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7665C", expiry: "9/2", price: 2.8, idempotency_key: `${k2}:stc` });
  rec("3-lot final close (STC×1 remainder)", closeRem.status === 200 && closeRem.body?.ok ? "PASS" : "FAIL", `msg=${closeRem.body?.message_id}`);

  // ── Scenario 3: long put (P strike) ──
  const k3 = `${SESSION}:put`;
  const btoPut = await trade(secret, { action: "BTO", qty: 1, ticker: "SPX", strike: "7600P", expiry: "9/2", price: 1.85, idempotency_key: `${k3}:bto` });
  rec("long PUT BTO", btoPut.status === 200 && btoPut.body?.ok ? "PASS" : "FAIL", `msg=${btoPut.body?.message_id}`);

  const stcPut = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7600P", expiry: "9/2", price: 2.1, idempotency_key: `${k3}:stc` });
  rec("long PUT STC", stcPut.status === 200 && stcPut.body?.ok ? "PASS" : "FAIL", `msg=${stcPut.body?.message_id}`);

  // ── Scenario 4: short STO → BTC ──
  const k4 = `${SESSION}:short`;
  const sto = await trade(secret, { action: "STO", qty: 1, ticker: "SPX", strike: "7700C", expiry: "9/2", price: 2.2, idempotency_key: `${k4}:sto` });
  rec("short STO open", sto.status === 200 && sto.body?.ok ? "PASS" : "FAIL", `msg=${sto.body?.message_id}`);

  const btc = await trade(secret, { action: "BTC", qty: 1, ticker: "SPX", strike: "7700C", expiry: "9/2", price: 1.5, idempotency_key: `${k4}:btc` });
  rec("short BTC close", btc.status === 200 && btc.body?.ok ? "PASS" : "FAIL", `msg=${btc.body?.message_id}`);

  // ── Scenario 6: Legacy desk → separate channel ──
  const k6 = `${SESSION}:legacy`;
  const legacyBto = await trade(secret, {
    action: "BTO",
    qty: 1,
    ticker: "MRNA",
    strike: "155C",
    expiry: "9/4",
    price: 5.28,
    author_name: "night-hawk-legacy",
    channel_id: "1544793338597871636",
    idempotency_key: `${k6}:bto`,
  });
  rec("Legacy channel BTO", legacyBto.status === 200 && legacyBto.body?.ok ? "PASS" : "FAIL", `msg=${legacyBto.body?.message_id ?? legacyBto.body?.detail}`);

  const legacyStc = await trade(secret, {
    action: "STC",
    qty: 1,
    ticker: "MRNA",
    strike: "155C",
    expiry: "9/4",
    price: 5.5,
    author_name: "night-hawk-legacy",
    channel_id: "1544793338597871636",
    idempotency_key: `${k6}:stc`,
  });
  rec("Legacy channel STC", legacyStc.status === 200 && legacyStc.body?.ok ? "PASS" : "FAIL", `msg=${legacyStc.body?.message_id ?? legacyStc.body?.detail}`);

  // ── Scenario 5: partial close then remainder ──
  const k5 = `${SESSION}:partial`;
  await trade(secret, { action: "BTO", qty: 2, ticker: "SPX", strike: "7670C", expiry: "9/2", price: 2.0, idempotency_key: `${k5}:bto` });
  const partial = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7670C", expiry: "9/2", price: 2.5, idempotency_key: `${k5}:partial` });
  rec("partial STC (2-lot, close 1)", partial.status === 200 && partial.body?.ok ? "PASS" : "FAIL", `msg=${partial.body?.message_id}`);

  const remainder = await trade(secret, { action: "STC", qty: 1, ticker: "SPX", strike: "7670C", expiry: "9/2", price: 2.3, idempotency_key: `${k5}:stc` });
  rec("remainder STC (close last 1)", remainder.status === 200 && remainder.body?.ok ? "PASS" : "FAIL", `msg=${remainder.body?.message_id}`);
}

async function main() {
  console.log(`\n=== Chief Trade Scenario Suite (${SESSION}) ===`);
  testPayloadBuilders();

  let secret;
  try {
    secret = getSecret();
  } catch (e) {
    rec("AWS secret fetch", "FAIL", e.message);
    process.exit(1);
  }

  await testLiveApi(secret);

  console.log("\n── Summary ──");
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASS ${pass} | FAIL ${fail} | TOTAL ${results.length}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => x.status === "FAIL")) {
      console.log(`  - ${r.scenario}: ${r.detail}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
