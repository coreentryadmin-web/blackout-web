#!/usr/bin/env node
/**
 * Live prod Largo multi-question probe — admin session, JSON (non-stream) answers.
 * READ-ONLY audit; temp Clerk user deleted in finally.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] || "audit-output/largo-live-ui-probe.json";

const QUESTIONS = [
  "What's the SPX setup right now?",
  "Compare HELIX flow vs Thermal GEX on SPX — where do they agree or conflict?",
  "How are today's 0DTE plays doing?",
  "What's VIX doing and does it matter for today's SPX read?",
  "Any unusual options flow on NVDA in the last hour?",
  "SPX?",
  "What would flip the current SPX read?",
  "List only the top 3 HELIX prints by premium right now",
  "What's our SPX play track record showing lately?",
  "Is 0DTE SPX long gamma or short gamma here — one sentence verdict",
];

const session = await mintClerkPremiumSession({
  appUrl: BASE,
  publicMetadata: { role: "admin", tier: "premium" },
  email: `claude-largo-probe-${Date.now()}@blackouttrades.com`,
});

if (session.skip) {
  console.error("SKIP:", session.reason);
  process.exit(2);
}

const results = [];
try {
  let cookie = session.cookieHeader;
  const refreshEvery = 55_000;
  let lastRefresh = Date.now();

  for (const question of QUESTIONS) {
    if (Date.now() - lastRefresh > refreshEvery && session.refresh) {
      const next = await session.refresh();
      if (next?.cookieHeader) {
        cookie = next.cookieHeader;
        lastRefresh = Date.now();
      }
    }

    const t0 = Date.now();
    let row = { question, ok: false, ms: 0 };
    try {
      const res = await fetch(`${BASE}/api/market/largo/query`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ question, session_id: `largo-ui-probe-${Date.now()}` }),
        signal: AbortSignal.timeout(125_000),
      });
      row.ms = Date.now() - t0;
      row.status = res.status;
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) {
        row.error = body.error || body.message || JSON.stringify(body).slice(0, 300);
        results.push(row);
        console.log(`FAIL ${row.status} ${row.ms}ms — ${question.slice(0, 60)}`);
        continue;
      }
      row.ok = true;
      row.tools_used = body.tools_used ?? [];
      row.ticker = body.ticker ?? null;
      row.envelope = body.envelope ? { headline: body.envelope.headline?.slice(0, 200), sections: Object.keys(body.envelope.sections || {}) } : null;
      row.verification = body.verification ?? null;
      row.followups = body.followups ?? [];
      row.answer_len = typeof body.answer === "string" ? body.answer.length : 0;
      row.answer_preview = typeof body.answer === "string" ? body.answer.slice(0, 2200) : "";
      row.flags = [];
      if (!body.envelope) row.flags.push("no_envelope");
      if (body.answer?.includes("Polygon") || body.answer?.includes("Unusual Whales")) row.flags.push("vendor_leak");
      if (body.answer?.match(/\$?\d+\.\d{6,}/)) row.flags.push("float_noise");
      if (body.verification?.unverified?.length) row.flags.push(`unverified_${body.verification.unverified.length}`);
      if (row.ms > 90_000) row.flags.push("slow");
      results.push(row);
      console.log(
        `OK ${row.ms}ms tools=${row.tools_used.length} env=${body.envelope ? "yes" : "no"} — ${question.slice(0, 55)}`
      );
    } catch (e) {
      row.ms = Date.now() - t0;
      row.error = e instanceof Error ? e.message : String(e);
      results.push(row);
      console.log(`ERR ${row.ms}ms — ${question.slice(0, 60)}: ${row.error}`);
    }
  }
} finally {
  await session.cleanup?.().catch(() => {});
}

mkdirSync("audit-output", { recursive: true });
const payload = { base: BASE, at: new Date().toISOString(), results };
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\nWrote ${OUT} (${results.filter((r) => r.ok).length}/${results.length} OK)`);

const bad = results.filter((r) => !r.ok || r.flags?.length);
process.exit(bad.length ? 1 : 0);
