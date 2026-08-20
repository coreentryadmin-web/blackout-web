#!/usr/bin/env node
/**
 * LARGO DEEP DIVE — paired Concrete vs Deep dive, graded on DATA CORRECTNESS, not just shape.
 *
 * WHY THIS EXISTS, when three Largo harnesses already do.
 *
 *   largo-spx-slayer-audit.mjs   grades ROUTING   — did the right tool get called?
 *   largo-spx-adversarial.mjs    grades HONESTY   — does it refuse to fabricate?
 *   largo-spx-trader-day.mjs     grades SHAPE     — is the answer short, scoped, prose?
 *
 * None of them checks the thing a trader actually loses money on: whether a NAMED LEVEL is the
 * RIGHT NUMBER. The adversarial harness's grounding test collects every SPX-magnitude number the
 * desk publishes into one bag and asks "is the stated number in the bag?" — with hundreds of
 * published levels, almost anything passes. It cannot tell a correct call wall from a put wall
 * quoted as a call wall, and it cannot see a claim that matches the WRONG FIELD.
 *
 * So this harness checks FIELD BY FIELD. It pulls the desk's own named values as ground truth,
 * extracts the corresponding CLAIMS out of the prose, and compares them one to one.
 *
 * THE SOURCE-CONFUSION CHECK IS THE POINT. When a claim does not match its own field, this does
 * not merely fail it — it searches every OTHER truth field for the stated value and reports which
 * one it matched. "gamma flip 6982.33" is not a hallucination; it is `pin.flip` surfaced under a
 * label that belongs to `gex.flip`. A plain mismatch report would call that made-up and send the
 * next person hunting a fabrication bug that does not exist. Naming the field it actually came
 * from turns an unactionable failure into a one-line fix.
 *
 * MEASURED ON PROD 2026-08-20, before this harness existed — three live gamma-flip values:
 *   gex.flip         7892.93   (what the UI and most answers show)
 *   gex.regime.flip  7887.06
 *   pin.flip         6982.33   (726 pts BELOW spot — implausible for a 0DTE book)
 * spot agreed exactly across endpoints (7707.98), so this is not a staleness artifact.
 *
 * PAIRED BY CONSTRUCTION. Every question runs in BOTH modes against the SAME truth snapshot,
 * taken once up front. Grading two modes against two snapshots would attribute live market drift
 * to the mode, which is how you "discover" a difference that is really just time passing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: judge whether a call is PROFITABLE. Off-hours "wait / no
 * trade" is a CORRECT answer and is scored as such.
 *
 * READ-ONLY. One temp Clerk user, deleted in a finally.
 *
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/largo-deep-dive.mjs [--json] [--limit=N]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.LARGO_DEEP_OUT ?? "audit-output/largo-deep-dive.json";
const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const LIMIT = Number((argv.find((a) => a.startsWith("--limit=")) ?? "").slice(8)) || null;

const LEN_TARGET = 700;
const LEN_CEILING = 1200;
/** A level must land this close to truth to count as the same number. */
const LEVEL_TOL_PCT = 0.15;

/* ────────────────────────────── question set ────────────────────────────── */

/**
 * `claims` names the truth fields this question's answer is expected to talk about. A question is
 * only graded on fields it should plausibly mention — asking "where are the walls" and then failing
 * the answer for not stating max pain would measure the harness's opinions, not the product.
 */
const QUESTIONS = [
  { id: "spot", q: "What is SPX trading at right now?", subject: "spot", claims: ["spot"] },
  { id: "walls", q: "Where are the SPX gamma walls?", subject: "walls", claims: ["call_wall", "put_wall"],
    foreign: [/confluence/i, /win rate/i, /grade [A-F]\b/] },
  { id: "flip", q: "Where is the SPX gamma flip?", subject: "flip", claims: ["gex_flip"],
    foreign: [/win rate/i, /confluence/i] },
  { id: "maxpain", q: "What is SPX max pain?", subject: "max pain", claims: ["max_pain"] },
  { id: "pin", q: "Where does SPX pin into the close?", subject: "pin", claims: ["pin"] },
  { id: "regime", q: "Is SPX in positive or negative gamma right now?", subject: "regime", claims: ["gex_flip", "spot"] },
  { id: "vanna", q: "Where are SPX vanna walls?", subject: "vanna", claims: ["vex_pos_wall", "vex_neg_wall"] },
  { id: "distance", q: "How far is SPX spot from the call wall?", subject: "distance", claims: ["spot", "call_wall"] },
  { id: "levels", q: "Give me the key SPX levels for today.", subject: "levels", claims: ["call_wall", "put_wall", "gex_flip"] },
  { id: "terse", q: "SPX?", subject: "spx", claims: ["spot"] },
];

/* ────────────────────────────── truth snapshot ────────────────────────────── */

/**
 * The desk's own named values. Named fields ONLY — never a bag of every number on the payload,
 * which is what made the previous grounding check unable to fail.
 */
async function truthSnapshot(cookie) {
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { cookie }, signal: AbortSignal.timeout(90_000) });
    return r.ok ? await r.json() : null;
  };
  const [gex, pin] = await Promise.all([
    get("/api/market/gex-heatmap?ticker=SPX"),
    get("/api/market/spx/pin"),
  ]);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    fields: {
      spot: num(gex?.spot ?? pin?.spot),
      call_wall: num(gex?.gex?.call_wall),
      put_wall: num(gex?.gex?.put_wall),
      gex_flip: num(gex?.gex?.flip),
      regime_flip: num(gex?.gex?.regime?.flip),
      pin_flip: num(pin?.flip),
      max_pain: num(gex?.max_pain),
      pin: num(pin?.pin),
      vex_pos_wall: num(gex?.vex?.pos_wall),
      vex_neg_wall: num(gex?.vex?.neg_wall),
      vex_flip: num(gex?.vex?.flip),
    },
    capturedAt: new Date().toISOString(),
  };
}

/* ────────────────────────────── claim extraction ────────────────────────────── */

const NUM = String.raw`(\d{1,2},\d{3}(?:\.\d+)?|\d{3,5}(?:\.\d+)?)`;
const toNum = (s) => Number(String(s).replace(/,/g, ""));

/**
 * Patterns that tie a LABEL to a NUMBER, in either order, because prose puts them both ways
 * ("call wall at 7800" and "7800 call wall"). Anchored on the label so a bare number elsewhere in
 * the sentence is never captured as a claim about it.
 */
/** Label anchors per field. The NUMBER is found relative to these, not baked into the pattern. */
const CLAIM_LABELS = {
  spot: [/\bspot\b/gi, /\btrading (?:at|around)\b/gi, /\bSPX\b(?=\s*\$?\d)/gi],
  call_wall: [/\bcall wall\b/gi],
  put_wall: [/\bput wall\b/gi],
  gex_flip: [/\b(?:gamma )?flip\b/gi],
  max_pain: [/\bmax pain\b/gi],
  pin: [/\bpins?\b/gi, /\bprojected close\b/gi],
  vex_pos_wall: [/\b(?:positive|pos)[- ]?vanna(?: wall)?\b/gi, /\bvanna (?:resistance|call) wall\b/gi],
  vex_neg_wall: [/\b(?:negative|neg)[- ]?vanna(?: wall)?\b/gi, /\bvanna (?:support|put) wall\b/gi],
};

/**
 * Numbers that are DISTANCES, not levels. "Spot is 185 points below the flip" states no spot.
 *
 * Without this the grader reported `spot: said 185, truth 7707.98 (97.6% off)` about an answer
 * whose very first token was the correct "SPX 7,707.98" — a false accusation of a 97% data error
 * against a correct answer, which is worse than missing a real one: it sends someone hunting a
 * fabrication bug that does not exist.
 */
/**
 * Clause boundary — but a comma inside a THOUSANDS SEPARATOR is not one.
 *
 * Splitting on a bare `,` cut "7,893.07" into "893.07" and "7,700" into "700", so the grader
 * reported plausible-looking wrong levels that were really its own arithmetic. The negative
 * lookahead keeps digit-group commas attached.
 */
const CLAUSE_BREAK = /[;\u2014\u2013\n]|,(?!\d{3}\b)|\band\b|\bwhile\b|\bbut\b/i;

const DISTANCE_SUFFIX_RE = /^\s*(?:pts?|points?|%)\b|^\s*(?:pts?|points?)?\s*(?:above|below|away|from|wide)\b/i;

/**
 * The claim for `field`, taken as the number NEAREST its label and never across a clause boundary.
 *
 * The first version scanned FORWARD up to 24 characters from the label and took the first number it
 * found. On real prose that reads straight past the answer into the next clause:
 *
 *   "support at 7,700 (put wall) and resistance at 7,800 (call wall)"   -> put_wall = 7800  WRONG
 *   "below the 7,893.07 flip — support at 7,700"                        -> flip     = 7700  WRONG
 *
 * Both answers were CORRECT; the grader was over-eager. A grader that manufactures failures is as
 * disqualifying as one that cannot see them — it just costs the opposite kind of time. So: search
 * BOTH directions, stop at clause punctuation, and take whichever candidate sits closest to the
 * label.
 */
export function extractClaim(text, field) {
  const s = String(text);
  const labels = CLAIM_LABELS[field] ?? [];
  let best = null;
  for (const labelRe of labels) {
    for (const lm of s.matchAll(labelRe)) {
      const at = lm.index ?? 0;
      const end = at + lm[0].length;
      // Clause-bounded windows on each side. `(`/`)` are NOT boundaries — "7,700 (put wall)" is one
      // clause and is the single most common way these levels are written.
      const after = s.slice(end, end + 40).split(CLAUSE_BREAK)[0] ?? "";
      const beforeRaw = s.slice(Math.max(0, at - 40), at);
      const beforeParts = beforeRaw.split(CLAUSE_BREAK);
      const before = beforeParts[beforeParts.length - 1] ?? "";

      for (const [side, seg, dist] of [["after", after, (m) => m.index ?? 0],
                                       ["before", before, (m) => before.length - ((m.index ?? 0) + m[0].length)]]) {
        for (const m of String(seg).matchAll(new RegExp(NUM, "g"))) {
          // Skip distances: the number is followed by pts/points/%/above/below.
          const tail = String(seg).slice((m.index ?? 0) + m[0].length);
          if (side === "after" && DISTANCE_SUFFIX_RE.test(tail)) continue;
          const n = toNum(m[1]);
          if (!Number.isFinite(n)) continue;
          const d = dist(m);
          if (best == null || d < best.d) best = { n, d };
        }
      }
    }
  }
  return best ? best.n : null;
}

const pctOff = (a, b) => (b === 0 ? Infinity : Math.abs((a - b) / b) * 100);

/**
 * Which truth field does `value` actually correspond to? This is what converts "wrong number" into
 * "right number, wrong source" — the difference between a fabrication hunt and a one-line fix.
 */
export function whichFieldMatches(value, fields, exclude) {
  const hits = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === exclude || v == null) continue;
    if (pctOff(value, v) <= LEVEL_TOL_PCT) hits.push(k);
  }
  return hits;
}

/* ────────────────────────────── shape grading ────────────────────────────── */

const HEADING_RE = /^\s*#{1,6}\s+\S/m;
const BULLET_RE = /^\s*[-*•]\s+\S/m;
const TABLE_RE = /^\s*\|.*\|\s*$/m;
const BOLD_LABEL_RE = /\*\*(Verdict|Facts|Interpretation|Confidence|Conflicts|Risk|Data|Bottom line)\b[^*]*\*\*\s*:?/i;
const SOURCE_TAG_RE = /\((?:[^()]*·[^()]*(?:live|stale|cached)[^()]*)\)/i;

function gradeShape(mode, sc, answer) {
  const fails = [];
  const notes = [];
  const len = answer.length;
  if (mode === "concrete") {
    const ceiling = sc.maxLen ?? LEN_CEILING;
    if (len > ceiling) fails.push(`${len} chars — over the ${ceiling} ceiling`);
    else if (len > LEN_TARGET) notes.push(`${len} chars — over target, under ceiling`);
    if (HEADING_RE.test(answer)) fails.push("markdown heading — Concrete is prose only");
    if (BULLET_RE.test(answer)) fails.push("bullet list — Concrete is prose only");
    if (TABLE_RE.test(answer)) fails.push("table — Concrete is prose only");
    const b = answer.match(BOLD_LABEL_RE);
    if (b) fails.push(`section label as bold text: ${b[0].slice(0, 30)}`);
    if (SOURCE_TAG_RE.test(answer)) fails.push("inline source tag — provenance belongs on the rails");
  } else {
    // Deep dive is ALLOWED structure. It is graded on substance, not brevity — the only shape
    // failure that matters here is a wall of text with no structure at all.
    notes.push(`${len} chars`);
  }
  for (const re of sc.foreign ?? []) {
    if (re.test(answer)) fails.push(`unasked concept dragged in (${re}) — question was about ${sc.subject}`);
  }
  return { fails, notes, len };
}

/* ────────────────────────────── transport ────────────────────────────── */

const TOKEN_MAX_MS = 45_000;
let cookie = null;
let mintedAt = 0;
let session = null;

async function ensureCookie() {
  if (cookie && Date.now() - mintedAt < TOKEN_MAX_MS) return cookie;
  const next = await session?.refresh?.().catch(() => null);
  if (next?.cookieHeader) { cookie = next.cookieHeader; mintedAt = Date.now(); }
  return cookie;
}

async function ask(sc, mode, sessionId) {
  const post = async (ck) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/market/largo/query`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ck },
      body: JSON.stringify({ question: sc.q, session_id: sessionId, desk_scope: "spx-slayer", depth: mode }),
      signal: AbortSignal.timeout(150_000),
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => ({}));
    return { status: res.status, answer: String(j.answer ?? j.text ?? ""), ms, tools: j.tools_used ?? null };
  };
  let r = await post(await ensureCookie());
  if (r.status === 401) {
    const next = await session?.refresh?.().catch(() => null);
    if (next?.cookieHeader) { cookie = next.cookieHeader; mintedAt = Date.now(); r = await post(cookie); }
  }
  return r;
}

/* ────────────────────────────── run ────────────────────────────── */

function gradeClaims(sc, answer, truth) {
  const checked = [];
  for (const field of sc.claims ?? []) {
    const want = truth.fields[field];
    if (want == null) { checked.push({ field, verdict: "NO_TRUTH" }); continue; }
    const got = extractClaim(answer, field);
    if (got == null) { checked.push({ field, verdict: "NOT_STATED", want }); continue; }
    const off = pctOff(got, want);
    if (off <= LEVEL_TOL_PCT) { checked.push({ field, verdict: "OK", want, got }); continue; }
    const alias = whichFieldMatches(got, truth.fields, field);
    checked.push({
      field,
      verdict: alias.length ? "WRONG_SOURCE" : "WRONG",
      want,
      got,
      offPct: Number(off.toFixed(2)),
      matchedInstead: alias,
    });
  }
  return checked;
}

/**
 * ONLY run the live audit when invoked directly.
 *
 * The unit tests import `extractClaim`/`whichFieldMatches` from this module. Without this guard the
 * import executes the IIFE below — which mints a Clerk user and starts hammering prod — so
 * `npx tsx --test` hangs for minutes and then dies mid-run, leaving a temp user behind. Exactly
 * this bug already cost a run in this repo's other audit harness.
 */
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=scripts\/)/, ""));

// NOT `await`ed: a top-level await here fails esbuild's cjs transform under `tsx --test`, which is
// how the unit tests import this module.
if (isDirectRun) void (async () => {
  mkdirSync("audit-output", { recursive: true });
  session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`SKIP: ${session.reason}`); process.exit(2); }
  cookie = session.cookieHeader;
  mintedAt = Date.now();

  const results = [];
  let truth;
  try {
    truth = await truthSnapshot(cookie);
    console.error("TRUTH:", JSON.stringify(truth.fields));
    // Report internal disagreement in the SOURCE data before grading any answer against it. A
    // harness that grades a model against self-contradictory truth and reports only the model's
    // score is blaming the wrong layer.
    const flips = { gex_flip: truth.fields.gex_flip, regime_flip: truth.fields.regime_flip, pin_flip: truth.fields.pin_flip };
    const vals = Object.values(flips).filter((v) => v != null);
    if (vals.length > 1 && pctOff(Math.max(...vals), Math.min(...vals)) > LEVEL_TOL_PCT) {
      console.error(`SOURCE DISAGREEMENT — gamma flip published as ${JSON.stringify(flips)}`);
    }

    const list = LIMIT ? QUESTIONS.slice(0, LIMIT) : QUESTIONS;
    for (const sc of list) {
      const row = { id: sc.id, q: sc.q, subject: sc.subject, modes: {} };
      for (const mode of ["concrete", "deep"]) {
        // A fresh session id per (question, mode) so a Concrete answer cannot prime the Deep one.
        const sid = `deep-${mode}-${sc.id}-${Date.now()}`;
        let r;
        try { r = await ask(sc, mode, sid); }
        catch (e) { r = { status: 0, answer: "", ms: 0, error: e.message }; }
        const shape = r.status === 200 && r.answer.trim() ? gradeShape(mode, sc, r.answer) : { fails: [`HTTP ${r.status}`], notes: [], len: 0 };
        const claims = r.status === 200 ? gradeClaims(sc, r.answer, truth) : [];
        const bad = claims.filter((c) => c.verdict === "WRONG" || c.verdict === "WRONG_SOURCE");
        row.modes[mode] = { status: r.status, ms: r.ms, len: shape.len, answer: r.answer, tools: r.tools, shapeFails: shape.fails, claims };
        const verdict = shape.fails.length || bad.length ? "FAIL" : "PASS";
        console.error(`[${verdict}] ${mode.padEnd(8)} ${sc.id.padEnd(10)} ${String(r.ms).padStart(6)}ms ${String(shape.len).padStart(5)}ch  ${sc.q.slice(0, 40)}`);
        for (const f of shape.fails) console.error(`         ✗ shape: ${f}`);
        for (const c of claims) {
          if (c.verdict === "OK") console.error(`         ✓ ${c.field}: ${c.got}`);
          else if (c.verdict === "WRONG_SOURCE") console.error(`         ✗ ${c.field}: said ${c.got}, truth ${c.want} — MATCHES ${c.matchedInstead.join("/")} INSTEAD`);
          else if (c.verdict === "WRONG") console.error(`         ✗ ${c.field}: said ${c.got}, truth ${c.want} (${c.offPct}% off)`);
          else if (c.verdict === "NOT_STATED") console.error(`         · ${c.field}: not stated (truth ${c.want})`);
        }
      }
      results.push(row);
    }
    writeFileSync(OUT, JSON.stringify({ base: BASE, truth, results }, null, 2));
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  // ── rollup ──
  const sum = (mode, pick) => results.map((r) => r.modes[mode]).filter(Boolean).map(pick);
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  const lines = ["", "═══ DEEP DIVE ROLLUP ═══"];
  for (const mode of ["concrete", "deep"]) {
    const lens = sum(mode, (m) => m.len).filter(Boolean);
    const mss = sum(mode, (m) => m.ms).filter(Boolean);
    const shapeFails = sum(mode, (m) => m.shapeFails.length).reduce((a, b) => a + b, 0);
    const claims = results.flatMap((r) => r.modes[mode]?.claims ?? []);
    const ok = claims.filter((c) => c.verdict === "OK").length;
    const wrongSrc = claims.filter((c) => c.verdict === "WRONG_SOURCE").length;
    const wrong = claims.filter((c) => c.verdict === "WRONG").length;
    const notStated = claims.filter((c) => c.verdict === "NOT_STATED").length;
    lines.push(
      `${mode.toUpperCase().padEnd(9)} len median ${String(med(lens)).padStart(5)}  latency median ${(med(mss) / 1000).toFixed(1)}s  ` +
      `shapeFails ${shapeFails}  claims ok=${ok} wrongSource=${wrongSrc} wrong=${wrong} notStated=${notStated}`
    );
  }
  console.log(AS_JSON ? JSON.stringify({ truth, results }, null, 2) : lines.join("\n"));
})();
