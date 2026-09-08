#!/usr/bin/env node
/**
 * LARGO PRODUCT-OWNER CONVERSATION PROBE — one live authenticated session, a fixed sequence of
 * questions posted with the SAME session_id so the server threads real conversation state, exactly
 * as a member's browser session would. Prints full turn detail (latency, tools_used, answer,
 * envelope headline) for manual grading on: Correctness, Freshness, Cross-product reasoning,
 * Actionability, Restraint/no-trade discipline, Conversation memory.
 *
 * Cookie refresh follows largo-stress-suite.mjs's own pattern (`makeCookieJar`): the `__session`
 * JWT is measured dead ~72s after mint and a multi-turn Deep conversation easily outlives that, so
 * this refreshes on a 45s timer (comfortably inside 72s) plus a forced re-mint + one retry on any
 * 401, distinguishing "harness auth expired mid-run" from "Largo actually rejected this turn".
 *
 * Usage: node --import tsx scripts/audit/largo-po-conversation-probe.mjs --questions=q1.json
 *   --questions points at a JSON array of strings (the turn sequence, in order).
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { readFileSync } from "node:fs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const questionsFile = args.questions;
if (!questionsFile) {
  console.error("Usage: --questions=<path.json> (JSON array of question strings)");
  process.exit(1);
}
const questions = JSON.parse(readFileSync(questionsFile, "utf8"));

function makeCookieJar(session) {
  let cookie = session.cookieHeader;
  let mintedAt = Date.now();
  const MAX_AGE_MS = 45_000;
  return async () => {
    if (Date.now() - mintedAt < MAX_AGE_MS) return cookie;
    const next = await session.refresh?.().catch(() => null);
    if (next?.cookieHeader) {
      cookie = next.cookieHeader;
      mintedAt = Date.now();
    }
    return cookie;
  };
}

async function askLargo(cookieHeader, question, sessionId) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ question, session_id: sessionId, depth: "deep" }),
  });
  const ms = Date.now() - t0;
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, ms, ...body };
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(1);
  }
  const { cleanup } = session;
  const cookieJar = makeCookieJar(session);
  const sessionId = `po-conv-${Date.now()}`;
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      let res = await askLargo(await cookieJar(), q, sessionId);
      if (res.status === 401) {
        const next = await session.refresh?.().catch(() => null);
        if (next?.cookieHeader) res = await askLargo(next.cookieHeader, q, sessionId);
      }
      console.log("\n" + "=".repeat(100));
      console.log(`TURN ${i + 1}/${questions.length} (${res.ms}ms, HTTP ${res.status})`);
      console.log(`Q: ${q}`);
      console.log(`tools: ${(res.tools_used || []).join(", ")}`);
      if (res.envelope?.headline) console.log(`Headline: ${res.envelope.headline}`);
      console.log(`Answer (${(res.answer || "").length} chars):\n${res.answer || "<empty>"}`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
