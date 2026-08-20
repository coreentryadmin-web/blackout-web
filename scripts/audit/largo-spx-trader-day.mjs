#!/usr/bin/env node
/**
 * SPX Slayer / Largo — a full-time SPX trader's whole day, and whether the answers are USABLE.
 *
 * The existing two harnesses cover routing (`largo-spx-slayer-audit.mjs`) and truthfulness
 * (`largo-spx-adversarial.mjs`). Neither grades the thing a member actually experiences: whether
 * the reply is SHORT, SCOPED TO THE QUESTION, and FAST. A reply can call every right tool, state
 * every number correctly, and still be unusable because the answer to "where are the walls" is
 * buried in nine paragraphs about flip, flow, regime and invalidation.
 *
 * MEASURED BEFORE the Concrete rewrite (prod, 2026-08-20):
 *   concrete median 5,650 chars  (deep median 4,960 — concrete was LONGER than deep)
 *   concrete median 24.5s, p90 34.6s
 * Target after: 400-700 chars, ceiling 1,200; and materially faster, because generation time
 * scales with tokens emitted — the length WAS the latency.
 *
 * THE SHAPE GRADER IS THE POINT. It checks:
 *   - length against the Concrete contract
 *   - NO markdown headings, NO bullet lists, NO tables, NO **bold inline labels** (the previous
 *     prompt banned "section headers" and got the same eight sections back as bold labels)
 *   - the first sentence carries a decision, not a preamble or a restatement of the question
 *   - SCOPE: a question about ONE subject must not drag in every other desk concept
 *   - latency
 *
 * The question set is written as a trader's session, open to close, because that is the order the
 * questions actually arrive in and it surfaces context-carryover bugs a shuffled matrix misses.
 *
 * WHAT IT CANNOT DO: it does not judge whether a call is PROFITABLE, and off-hours "wait / no
 * trade" is CORRECT and scored as such. A 03:00 ET run says nothing about play quality.
 *
 * READ-ONLY. One temp Clerk user, deleted in a finally.
 *
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/largo-spx-trader-day.mjs [--json] [--limit=N]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.LARGO_DAY_OUT ?? "audit-output/largo-spx-trader-day.json";
const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const LIMIT = Number((argv.find((a) => a.startsWith("--limit=")) ?? "").slice(8)) || null;

/** Concrete contract: target 400-700, hard ceiling 1,200. */
const LEN_TARGET = 700;
const LEN_CEILING = 1200;

/**
 * A trader's session. `subject` names what was asked about; `foreign` are concepts that must NOT
 * be dragged in unasked. Keep `foreign` to things genuinely off-topic — a walls question may
 * legitimately mention spot (you need it to say "2pts below"), but has no business delivering the
 * play grade or the confluence score.
 */
const DAY = [
  // ── pre-open ───────────────────────────────────────────────────────────────────────────────
  { id: "pre-overnight", q: "What happened to SPX overnight?", subject: "overnight", foreign: [/confluence score/i, /gate \d/i] },
  { id: "pre-levels", q: "What are the key SPX levels for today?", subject: "levels" },
  { id: "pre-macro", q: "Any macro events today that matter for SPX?", subject: "macro", want: /\b(fomc|cpi|ppi|pce|jobs|nfp|claims|none|no (?:major )?(?:events|releases)|calendar|nothing)\b/i },
  { id: "pre-iv", q: "What's SPX IV rank right now?", subject: "iv", foreign: [/gamma flip/i, /put wall/i] },

  // ── the open ───────────────────────────────────────────────────────────────────────────────
  { id: "open-bias", q: "Is SPX bullish or bearish right now?", subject: "bias" },
  { id: "open-walls", q: "Where are the SPX gamma walls?", subject: "walls", foreign: [/confluence/i, /grade [A-F]\b/i, /win rate/i] },
  { id: "open-flip", q: "Where is the SPX gamma flip?", subject: "flip", foreign: [/win rate/i, /confluence/i] },
  { id: "open-play", q: "What's the best SPX play today?", subject: "play" },

  // ── intraday ───────────────────────────────────────────────────────────────────────────────
  { id: "mid-flow", q: "What's the SPX options flow showing?", subject: "flow", foreign: [/ema\d+/i, /vwap/i] },
  { id: "mid-conflict", q: "Do flow and gamma agree on SPX right now?", subject: "conflict" },
  { id: "mid-vex", q: "What's SPX vanna exposure doing?", subject: "vex" },
  { id: "mid-internals", q: "What are TICK and TRIN saying?", subject: "internals", foreign: [/put wall/i, /call wall/i] },
  { id: "mid-pin", q: "Where does SPX pin into the close?", subject: "pin", foreign: [/confluence/i, /flow/i] },

  // ── the trade ──────────────────────────────────────────────────────────────────────────────
  { id: "trade-strike", q: "Which SPX strike should I buy for a 0DTE call?", subject: "strike" },
  { id: "trade-stop", q: "Where's my invalidation if I'm long SPX here?", subject: "invalidation" },
  { id: "trade-size", q: "How much should I risk on this SPX trade?", subject: "sizing" },
  { id: "trade-condor", q: "Is there an iron condor setup on SPX today?", subject: "condor" },

  // ── power hour / close ─────────────────────────────────────────────────────────────────────
  { id: "ph-power", q: "Anything for SPX power hour?", subject: "power hour" },
  { id: "ph-hold", q: "Should I hold my SPX position into the close?", subject: "hold" },
  { id: "close-record", q: "How has the SPX desk done this month?", subject: "record", foreign: [/gamma flip/i, /put wall/i] },

  // ── multi-horizon ──────────────────────────────────────────────────────────────────────────
  { id: "dte-3", q: "Best 3DTE SPX setup?", subject: "3dte" },
  { id: "dte-7", q: "What about a 7DTE SPX position?", subject: "7dte" },

  // ── the one-word and the sloppy ────────────────────────────────────────────────────────────
  { id: "terse-spx", q: "SPX?", subject: "spx", maxLen: 700 },
  { id: "terse-walls", q: "walls?", subject: "walls", maxLen: 700 },
  { id: "sloppy", q: "spx gud rn or nah", subject: "bias" },
];

const HEADING_RE = /^\s*#{1,6}\s+\S/m;
const BULLET_RE = /^\s*[-*•]\s+\S/m;
const TABLE_RE = /^\s*\|.*\|\s*$/m;
/** The eight sections, as bold inline labels — the shape the old prompt allowed through. */
const BOLD_LABEL_RE = /\*\*(Verdict|Facts|Interpretation|Confidence|Conflicts|Risk|Data|Bottom line)\b[^*]*\*\*\s*:?/i;
/** A first sentence that decides something, rather than restating the question. */
const PREAMBLE_RE = /^\s*(sure|certainly|here'?s|let me|i'?ll|to answer|great question|based on (?:the|your))/i;

function firstSentence(text) {
  const t = String(text).trim().replace(/^\*\*[^*]+\*\*\s*:?\s*/, "");
  const m = t.match(/^[^.!?\n]{10,400}[.!?]/);
  return (m ? m[0] : t.slice(0, 240)).trim();
}

/**
 * THE SESSION JWT OUTLIVES ITS USEFULNESS LONG BEFORE THE RUN ENDS.
 *
 * The Clerk `__session` token is short-lived (~72s). A 25-question run at ~15s/question is over six
 * minutes, so without rotation everything after roughly question four returns HTTP 401 — and a
 * harness that reports those as ERROR reads exactly like a broken product. Observed on the first
 * run of this file: 4 real answers, then five straight 401s.
 *
 * Two guards, mirroring largo-spx-slayer-audit.mjs: refresh PROACTIVELY on an age timer, and
 * retry once REACTIVELY on a 401, because the proactive timer cannot know when the server rotated
 * early. A single ask() is never allowed to consume the run's only credential.
 */
const TOKEN_MAX_MS = 45_000;
let cookie = null;
let tokenMintedAt = 0;
let session = null;

async function ensureCookie() {
  if (cookie && Date.now() - tokenMintedAt < TOKEN_MAX_MS) return cookie;
  if (session?.refresh) {
    const next = await session.refresh().catch(() => null);
    if (next?.cookieHeader) {
      cookie = next.cookieHeader;
      tokenMintedAt = Date.now();
    }
  }
  return cookie;
}

async function ask(_unused, sc, sessionId) {
  const post = async (ck) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/market/largo/query`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck },
      body: JSON.stringify({
        question: sc.q,
        session_id: sessionId,
        desk_scope: "spx-slayer",
        ...(sc.sub ? { desk_scope_args: { submodule: sc.sub } } : {}),
        depth: "concrete",
      }),
      signal: AbortSignal.timeout(125_000),
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => ({}));
    return { status: res.status, answer: String(j.answer ?? j.text ?? ""), ms, tools: j.tools_used ?? null };
  };

  let r = await post(await ensureCookie());
  if (r.status === 401 && session?.refresh) {
    const next = await session.refresh().catch(() => null);
    if (next?.cookieHeader) {
      cookie = next.cookieHeader;
      tokenMintedAt = Date.now();
      r = await post(cookie);
    }
  }
  return r;
}

function gradeShape(sc, r) {
  const a = r.answer;
  const fails = [];
  const notes = [];
  if (r.status !== 200) return { verdict: "ERROR", fails: [`HTTP ${r.status}`], notes };
  if (!a.trim()) return { verdict: "FAIL", fails: ["empty answer"], notes };

  const len = a.length;
  const ceiling = sc.maxLen ?? LEN_CEILING;
  if (len > ceiling) fails.push(`${len} chars — over the ${ceiling} ceiling`);
  else if (len > LEN_TARGET) notes.push(`${len} chars — over the ${LEN_TARGET} target, under ceiling`);
  else notes.push(`${len} chars — within target`);

  if (HEADING_RE.test(a)) fails.push("markdown heading present — Concrete is prose only");
  if (BULLET_RE.test(a)) fails.push("bullet list present — Concrete is prose only");
  if (TABLE_RE.test(a)) fails.push("table present — Concrete is prose only");
  const bold = a.match(BOLD_LABEL_RE);
  if (bold) fails.push(`section label as bold inline text: ${bold[0].slice(0, 32)}`);

  const fs = firstSentence(a);
  if (PREAMBLE_RE.test(fs)) fails.push(`first sentence is a preamble, not the answer: "${fs.slice(0, 70)}"`);

  // SCOPE: named foreign concepts must not appear in an answer that did not ask for them.
  for (const re of sc.foreign ?? []) {
    if (re.test(a)) fails.push(`dragged in an unasked concept (${re}) — question was about ${sc.subject}`);
  }

  if (sc.want && !sc.want.test(a)) fails.push(`never addressed ${sc.want}`);

  return { verdict: fails.length ? "FAIL" : "PASS", fails, notes, len, firstSentence: fs };
}

(async () => {
  mkdirSync("audit-output", { recursive: true });
  session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  cookie = session.cookieHeader;
  tokenMintedAt = Date.now();

  const results = [];
  try {
    const sid = `traderday-${Date.now()}`;
    const list = LIMIT ? DAY.slice(0, LIMIT) : DAY;
    for (const sc of list) {
      let r;
      try {
        r = await ask(null, sc, sid);
      } catch (e) {
        r = { status: 0, answer: "", ms: 0, tools: null, error: e.message };
      }
      const g = gradeShape(sc, r);
      results.push({ ...sc, foreign: undefined, want: undefined, status: r.status, ms: r.ms, answer: r.answer, ...g });
      console.error(
        `[${g.verdict === "PASS" ? "PASS" : g.verdict}] ${sc.id.padEnd(16)} ${String(r.ms).padStart(6)}ms ${String(g.len ?? 0).padStart(5)}ch  ${sc.q.slice(0, 46)}`
      );
      for (const f of g.fails) console.error(`         ✗ ${f}`);
    }
    writeFileSync(OUT, JSON.stringify({ base: BASE, results }, null, 2));
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  const ok = results.filter((r) => r.verdict === "PASS").length;
  const lens = results.map((r) => r.len ?? 0).filter(Boolean).sort((a, b) => a - b);
  const mss = results.map((r) => r.ms).filter(Boolean).sort((a, b) => a - b);
  const med = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0);
  const p90 = (xs) => (xs.length ? xs[Math.max(0, Math.ceil(xs.length * 0.9) - 1)] : 0);

  console.error(`\n${ok}/${results.length} passed the shape contract`);
  console.error(`length  median ${med(lens)}ch  p90 ${p90(lens)}ch  max ${lens[lens.length - 1] ?? 0}ch   (target ${LEN_TARGET}, ceiling ${LEN_CEILING})`);
  console.error(`latency median ${(med(mss) / 1000).toFixed(1)}s  p90 ${(p90(mss) / 1000).toFixed(1)}s`);
  console.error(`report: ${OUT}`);
  if (AS_JSON) console.log(JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.verdict === "ERROR") ? 1 : 0);
})().catch((e) => {
  console.error("TRADER-DAY AUDIT FAILED:", e.message);
  process.exit(1);
});
