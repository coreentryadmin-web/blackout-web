#!/usr/bin/env node
/**
 * LARGO PRODUCT-OWNER BREADTH PROBE — independent single-shot questions, ONE per session_id (a
 * shared thread would let answer N lean on answer N-1's context, hiding tool-reach failures — same
 * rationale as largo-stress-suite.mjs's own per-question session id). Companion to
 * largo-po-conversation-probe.mjs (which deliberately shares one session_id across turns).
 *
 * Usage: node --import tsx scripts/audit/largo-po-breadth-probe.mjs --questions=q.json
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
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sid = `po-breadth-${i}-${Date.now()}`;
      let res = await askLargo(await cookieJar(), q, sid);
      if (res.status === 401) {
        const next = await session.refresh?.().catch(() => null);
        if (next?.cookieHeader) res = await askLargo(next.cookieHeader, q, sid);
      }
      console.log("\n" + "=".repeat(100));
      console.log(`Q${i + 1}/${questions.length} (${res.ms}ms, HTTP ${res.status})`);
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
