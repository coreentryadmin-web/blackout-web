#!/usr/bin/env node
/**
 * SPX CONFIDENCE-BOUNDARY LIVE PROBE — did the uncalibrated `confidence` actually stop at the
 * Largo boundary, in production?
 *
 * #2646 replaced SPX Slayer's `confidence` with a named `confidence_omitted` note at the four
 * points where an SPX payload reaches the model (`run-tool.ts:964,1574`, `ecosystem-context.ts:853`,
 * `largo-live-feed.ts:788`). That was code-verified and never observed live, and the obvious ways
 * to observe it do not work:
 *
 *   - Grepping the ANSWER ENVELOPE is the wrong vantage point. The substitution happens inside the
 *     TOOL RESULT handed to the model; the envelope returned to the client never carried it either
 *     way. Measured: a live envelope contains the string "confidence" (from unrelated keys) and no
 *     "confidence_omitted" — which proves nothing in either direction, and would read as a
 *     regression to anyone who stopped there.
 *   - Running the tool in-process is not possible from the audit sandbox: `getSpxPlayState` is
 *     DB/HTTP-backed behind `server-only` guards.
 *
 * So this asks the LIVE agent, which runs where the data is, to report what its own tool result
 * contained — the same trick `largo-truncation-probe.mjs` uses for the 16k cap.
 *
 * THE RULE THAT MAKES IT TRUSTWORTHY. The instrument is a model, so "it says there was no
 * confidence field" is indistinguishable from "it never looked" unless something proves it read the
 * payload at all. Every run therefore also asks for two fields KNOWN to be present — `grade` and
 * `score` — and if those do not come back with concrete values the run reports **UNVERIFIED**
 * rather than clean. A tool absent from `tools_used` is INDETERMINATE, never a pass.
 *
 * READ-ONLY. One temp Clerk user, released before exit. Exits non-zero on a confidence leak, an
 * unproven instrument, or an indeterminate route.
 *
 * Run:  node scripts/audit/spx-largo-confidence-probe.mjs [--base=…] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const BASE = flag("base", "https://blackouttrades.com").replace(/\/$/, "");
const JSON_OUT = args.includes("--json");

/**
 * Each case names the tool it must route through. The question asks for the CONTROL fields first
 * so a truncated or lazy answer fails the control rather than silently passing the real check.
 */
const CASES = [
  {
    id: "spx-confluence",
    tool: "get_spx_confluence",
    question:
      "Call the SPX confluence tool. Then answer ONLY with these four lines, no prose: " +
      "GRADE=<the grade field verbatim, or NONE>; " +
      "SCORE=<the score field verbatim, or NONE>; " +
      "CONFIDENCE=<the value of a `confidence` field if the tool result had one, or NONE>; " +
      "CONFIDENCE_OMITTED=<YES if the tool result had a `confidence_omitted` key, otherwise NO>.",
  },
  {
    id: "spx-play",
    tool: "get_spx_play",
    question:
      "Call the SPX play tool. Then answer ONLY with these four lines, no prose: " +
      "GRADE=<the grade field verbatim, or NONE>; " +
      "SCORE=<the score field verbatim, or NONE>; " +
      "CONFIDENCE=<the value of a `confidence` field if the tool result had one, or NONE>; " +
      "CONFIDENCE_OMITTED=<YES if the tool result had a `confidence_omitted` key, otherwise NO>.",
  },
];

const field = (text, key) => {
  const m = new RegExp(`${key}\\s*=\\s*([^;\\n]+)`, "i").exec(text ?? "");
  return m ? m[1].trim().replace(/[.*_`]+$/, "").trim() : null;
};
const isNone = (v) => v == null || /^none$/i.test(v) || v === "" || /^n\/?a$/i.test(v);

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error("[spx-confidence] no Clerk session — SKIPPED, not clean");
    return 2;
  }
  const rows = [];
  try {
    for (const c of CASES) {
      const cookie = (await session.refresh?.())?.cookieHeader || session.cookieHeader;
      const r = await fetch(`${BASE}/api/market/largo/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ question: c.question, session_id: `spxconf-${c.id}-${Date.now()}` }),
      });
      if (!r.ok) {
        rows.push({ ...c, verdict: "INDETERMINATE", detail: `HTTP ${r.status}` });
        continue;
      }
      const j = await r.json();
      const toolsUsed = Array.isArray(j.tools_used)
        ? j.tools_used.map((t) => (typeof t === "string" ? t : t?.name ?? t?.tool ?? "")).filter(Boolean)
        : [];
      const answer = String(j.answer ?? "");
      if (!toolsUsed.includes(c.tool)) {
        // The route not firing is not evidence about the boundary. Never a pass.
        rows.push({ ...c, verdict: "INDETERMINATE", detail: `${c.tool} not in tools_used [${toolsUsed.join(", ")}]`, tools_used: toolsUsed });
        continue;
      }
      const grade = field(answer, "GRADE");
      const score = field(answer, "SCORE");
      const confidence = field(answer, "CONFIDENCE");
      const omitted = field(answer, "CONFIDENCE_OMITTED");
      // CONTROL FIRST: if the model could not report fields we know are there, its report about
      // the field we care about is worthless.
      if (isNone(grade) && isNone(score)) {
        rows.push({ ...c, verdict: "UNVERIFIED", detail: "control fields GRADE and SCORE both came back NONE — the model did not read the payload, so its confidence report proves nothing", grade, score, confidence, omitted, tools_used: toolsUsed });
        continue;
      }
      const leaked = !isNone(confidence);
      rows.push({
        ...c,
        verdict: leaked ? "LEAK" : /^yes$/i.test(omitted ?? "") ? "OMITTED" : "PARTIAL",
        detail: leaked
          ? `a \`confidence\` value crossed the boundary: ${confidence}`
          : /^yes$/i.test(omitted ?? "")
            ? "no `confidence`, and `confidence_omitted` present — the boundary held"
            : "no `confidence`, but `confidence_omitted` was not reported either — absence is unnamed, which is weaker than the fix intends",
        grade, score, confidence, omitted, tools_used: toolsUsed,
      });
    }
  } finally {
    // Released before exit, never in a finally racing process.exit — that leaks the temp user.
    await session.cleanup?.();
  }

  const bad = rows.filter((r) => r.verdict === "LEAK");
  const unproven = rows.filter((r) => r.verdict === "UNVERIFIED" || r.verdict === "INDETERMINATE");
  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, rows, verdict: bad.length ? "RED" : unproven.length ? "UNPROVEN" : "GREEN" }, null, 2));
  } else {
    console.log(`SPX confidence boundary — ${BASE}`);
    for (const r of rows) {
      console.log(`\n  [${r.id}] ${r.verdict}  (${r.tool})`);
      console.log(`    ${r.detail}`);
      if (r.grade != null || r.score != null) console.log(`    control: GRADE=${r.grade} SCORE=${r.score}`);
    }
    console.log(`\n  verdict: ${bad.length ? "RED — confidence is still crossing" : unproven.length ? "UNPROVEN — instrument or route did not hold" : "GREEN — boundary held on every case"}`);
  }
  return bad.length ? 1 : unproven.length ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[spx-confidence] ${err?.message ?? err}`);
    process.exit(1);
  });
