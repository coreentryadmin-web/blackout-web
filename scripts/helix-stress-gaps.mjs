#!/usr/bin/env node
/**
 * Second HELIX stress round — hunts CAPABILITY GAPS (not correctness): questions where the data
 * may not be exposed at all, so Largo has to either answer well, or say honestly it cannot.
 * Targets C10 historical baseline, cross-product joins, precision/units, per-type reliability,
 * multi-signal synthesis, whole-tape counts, identity, methodology.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintAppSession } from "./audit/lib/app-session.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
  // C10 — is there ANY historical baseline for the tape's own skew?
  "Is today's SPX call/put premium skew unusual compared to its recent norm, or typical? Give me the baseline you're comparing against.",
  // Cross-product join — HELIX flow vs Vector on the same name (report disagreement, don't reconcile).
  "Does the HELIX flow on NVDA agree with what Vector's screener says about NVDA? If they differ, tell me how.",
  // Precision / units — can I verify the premium from its parts?
  "For the single largest HELIX print right now, give me the exact fill price, contract count, and the contract multiplier, so I can check the premium myself.",
  // Per-type reliability (the #2530 gap — aggregate-only today).
  "Over the HELIX signal history, do split_flow or velocity_spike signals continue in their direction more often? Give me each one's rate and sample size.",
  // Multi-signal synthesis.
  "On TSLA, if there is a velocity spike in calls but the 0DTE horizon is put-heavy, what is the NET HELIX read — and which signal should I weight more?",
  // Whole-tape count (the #2532 silent-cap gap — display limit today).
  "How many contracts in total are stacking right now across the whole HELIX tape, not just the top few?",
  // Identity edge.
  "Is HELIX flow on SPX the same as SPXW, or are those different instruments I should not combine?",
  // Methodology / provenance.
  "How does HELIX decide a print is a 'whale' versus normal flow, and what premium threshold does it use?",
];

async function askLive(cookieHeader, question) {
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ question, session_id: `helix-gaps-${process.pid}-${globalThis.__n = (globalThis.__n ?? 0) + 1}` }),
    },
    { retries: 1, timeoutMs: 120_000 }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, answer: body?.answer ?? "", source: body?.source, ms: Date.now() - t0 };
}

const session = await mintAppSession({ appUrl: BASE });
if (session.skip) { console.error("auth skip:", session.reason); process.exit(2); }

let cookie = session.cookieHeader;
let mintedAt = Date.now();
const TOKEN_MAX_AGE_MS = 55_000;
async function getCookie() {
  if (Date.now() - mintedAt > TOKEN_MAX_AGE_MS && session.refresh) {
    const n = await session.refresh().catch(() => null);
    if (n?.cookieHeader) { cookie = n.cookieHeader; mintedAt = Date.now(); }
  }
  return cookie;
}

const results = [];
for (const q of QUESTIONS) {
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = await askLive(await getCookie(), q);
    if (r.status === 200) break;
    if (r.status === 401) { mintedAt = 0; continue; }
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 2500 * (i + 1))); continue; }
    break;
  }
  results.push({ q, ...r });
  console.log(`\n${"=".repeat(90)}\nQ: ${q}\n[${r.status} · ${r.ms}ms]\n${"-".repeat(90)}\n${r.answer || "(empty)"}`);
  await new Promise((res) => setTimeout(res, 1200));
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(join(OUT, `helix-stress-gaps-${stamp}.json`), JSON.stringify(results, null, 2));
console.log(`\n\nWrote audit-output/helix-stress-gaps-${stamp}.json`);
await session.cleanup?.();
