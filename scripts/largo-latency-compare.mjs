#!/usr/bin/env node
/**
 * Largo response-time probe — production (Clerk premium session).
 *
 * Was "staging vs production". Every run of this npm-wired script (`validate:largo-latency`)
 * was a guaranteed crash from TWO independent dead dependencies, both from before the current
 * infra:
 *   - `loadStagingSecret()` read Secrets Manager's `blackout-staging/app/env`, which no longer
 *     exists — the whole `blackout-staging-*` stack was permanently decommissioned 2026-07-25
 *     (CLAUDE.md: "Do NOT reference the deleted blackout-staging-* stack or
 *     staging.blackouttrades.com"), confirmed live via `secretsmanager.describe_secret` ->
 *     ResourceNotFoundException.
 *   - `loadProdWebSecret()` shelled out to `railway variables ...` for the PROD Clerk keys — the
 *     Railway CLI, a tool this project stopped using entirely when infra moved to AWS ECS
 *     (CLAUDE.md: "All infrastructure runs on AWS ECS only — there is no Railway"). `spawnSync`
 *     on a missing binary never throws, so this reached `if (res.status !== 0) throw ...`
 *     unconditionally on any machine without a Railway install for this project.
 * Production is the only environment now; this is a single-target latency probe against it. The
 * prod Clerk keys are already ambient env vars in this environment (CLERK_SECRET_KEY,
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — see CLAUDE.md's "Environment realities"), so
 * `mintClerkPremiumSession` (already imported, and how every other current live-login audit
 * script does this — data-validator.mjs, meridian-earnings-ui-audit.mjs, etc.) needs no loader at
 * all.
 *
 * Usage: node scripts/largo-latency-compare.mjs [--rounds=3]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";

const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 3);
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const PROD_ENV = { label: "prod", base: "https://blackouttrades.com" };

const SESSION_ID = "latency-audit";
const SIMPLE_Q = "What is SPX spot right now?";
const TOOL_Q = "Summarize SPX gamma flip and key GEX levels in one short paragraph with dollar amounts.";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const ok = samples.filter((s) => s.ok);
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    n: samples.length,
    ok: ok.length,
    fail: samples.length - ok.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    min: ms[0] ?? null,
    max: ms[ms.length - 1] ?? null,
  };
}

async function largoSession(base, cookieHeader) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}/api/market/largo/session?session_id=${SESSION_ID}`,
    { headers: { Cookie: cookieHeader, Accept: "application/json" } },
    { retries: 2, timeoutMs: 60_000 }
  );
  await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0), ok: res.status === 200 };
}

async function largoQueryJson(base, cookieHeader, question) {
  const t0 = performance.now();
  const res = await fetchRetry(
    `${base}/api/market/largo/query`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ question, session_id: SESSION_ID }),
    },
    { retries: 1, timeoutMs: 180_000 }
  );
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const ms = Math.round(performance.now() - t0);
  const answered = Boolean(body.answer || body.text || body.message);
  return { status: res.status, ms, ok: res.status === 200 && answered, tools: body.tools_used?.length ?? 0, preview: String(body.answer || body.text || "").slice(0, 80) };
}

async function largoQueryStream(base, cookieHeader, question) {
  const t0 = performance.now();
  let firstTokenMs = null;
  let doneMs = null;
  let answer = "";
  let tools = [];
  let status = 0;
  try {
    const res = await fetch(`${base}/api/market/largo/query?stream=1`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ question, session_id: SESSION_ID }),
      signal: AbortSignal.timeout(180_000),
    });
    status = res.status;
    const raw = await res.text();
    doneMs = Math.round(performance.now() - t0);
    if (status === 200) {
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token" && ev.text) {
            if (firstTokenMs == null) firstTokenMs = Math.round(performance.now() - t0);
            answer += ev.text;
          }
          if (ev.type === "done") {
            answer = ev.answer || answer;
            tools = ev.tools_used || tools;
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch (e) {
    doneMs = Math.round(performance.now() - t0);
    return { status: 0, ms: doneMs, firstTokenMs, ok: false, err: e.message, tools: 0, preview: "" };
  }
  return {
    status,
    ms: doneMs,
    firstTokenMs,
    ok: status === 200 && answer.length > 20,
    tools: tools.length,
    preview: answer.slice(0, 80),
  };
}

async function runEnv(env) {
  const auth = await mintClerkPremiumSession({ appUrl: env.base });
  if (auth.skip) throw new Error(`${env.label} Clerk auth skipped: ${auth.reason}`);

  try {
    const sessionSamples = [];
    const simpleSamples = [];
    const toolSamples = [];
    const streamSamples = [];

    console.log(`\n=== ${env.label} (${env.base}) ===\n`);

    for (let i = 0; i < ROUNDS; i++) {
      const s = await largoSession(env.base, auth.cookieHeader);
      sessionSamples.push(s);
      console.log(`  [session r${i + 1}] HTTP ${s.status} ${s.ms}ms`);
    }

    for (let i = 0; i < ROUNDS; i++) {
      const q = await largoQueryJson(env.base, auth.cookieHeader, SIMPLE_Q);
      simpleSamples.push(q);
      console.log(`  [simple-query r${i + 1}] HTTP ${q.status} ${q.ms}ms tools=${q.tools}`);
    }

    // One heavier JSON query (tool-using)
    const tq = await largoQueryJson(env.base, auth.cookieHeader, TOOL_Q);
    toolSamples.push(tq);
    console.log(`  [tool-query] HTTP ${tq.status} ${tq.ms}ms tools=${tq.tools} preview="${tq.preview}"`);

    // One SSE stream (terminal path)
    const st = await largoQueryStream(env.base, auth.cookieHeader, TOOL_Q);
    streamSamples.push(st);
    console.log(
      `  [stream-query] HTTP ${st.status} total=${st.ms}ms firstToken=${st.firstTokenMs ?? "n/a"}ms tools=${st.tools}`
    );

    return {
      label: env.label,
      base: env.base,
      session: stats(sessionSamples),
      simpleQuery: stats(simpleSamples),
      toolQuery: stats(toolSamples),
      streamQuery: stats(streamSamples),
      streamFirstToken: st.firstTokenMs,
      samples: { sessionSamples, simpleSamples, toolSamples, streamSamples },
    };
  } finally {
    await auth.cleanup();
  }
}

async function main() {
  console.log(`\n=== Largo latency (${ROUNDS} rounds) ===\n`);
  let prod;
  try {
    prod = await runEnv(PROD_ENV);
  } catch (e) {
    console.error(`  ✗ ${PROD_ENV.label}: ${e.message}`);
    prod = { label: PROD_ENV.label, error: e.message };
  }

  console.log("\n=== Summary (ms) ===\n");
  console.log("| Endpoint | Prod p50 | Prod p95 |");
  console.log("|----------|----------|----------|");

  for (const key of ["session", "simpleQuery", "toolQuery", "streamQuery"]) {
    const p = prod?.[key];
    if (!p) continue;
    console.log(`| ${key} | ${p?.p50 ?? "—"} | ${p?.p95 ?? "—"} |`);
  }

  if (prod?.streamFirstToken != null) {
    console.log(`| stream first token | ${prod.streamFirstToken} | — |`);
  }

  const path = join(OUT, `largo-latency-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ ts: new Date().toISOString(), rounds: ROUNDS, prod }, null, 2));
  console.log(`\nReport: ${path}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
