#!/usr/bin/env node
/**
 * NIGHT HAWK × LARGO STRESS HARNESS — ask live Largo hard member questions, grade every answer
 * against the product's OWN ground truth, and fail on any regression.
 *
 * WHY THIS EXISTS. The charter for this lane: "continuously test Largo with realistic and
 * difficult member questions... validate every Largo answer against actual product data." A
 * one-off sweep found four member-facing defects in a morning (an invented iron-condor win rate,
 * a self-contradictory gate denominator, a fabricated market-open, a closed winner shown as a
 * loss). This makes that sweep repeatable and turns each fixed defect into a standing regression
 * check on Largo's ANSWERS — the layer no unit test covers, because it lives in a model reading a
 * tool payload in production.
 *
 * HOW. For each check: a member QUESTION, a GROUND-TRUTH fetch from the product's own endpoint,
 * and a pure grader (lib/nighthawk-largo-checks.mjs) that returns PASS/FAIL + evidence. The
 * grading is pure and unit-tested; only the asking and fetching are IO.
 *
 * THE SESSION LESSON. The minted Clerk JWT dies ~72s after issue, so a multi-question run must
 * refresh() before each ask — without it every question after the ~third came back 401 and the
 * run read as "Largo could not answer" when the harness had simply lost its own session.
 *
 * READ-ONLY. Asks questions, reads endpoints, changes nothing. One temp Clerk user, deleted in a
 * finally. Run from the repo root:
 *   node --import tsx scripts/audit/nighthawk-largo-stress.mjs [--base=https://blackouttrades.com] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  condorDeniedExists,
  condorWinRateHasBreachCompanion,
  sessionClaimMatchesPhase,
  pnlSignFlips,
  statedRatesAreSelfConsistent,
} from "./lib/nighthawk-largo-checks.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const BASE = arg("base", "https://blackouttrades.com").replace(/\/$/, "");
const JSON_OUT = process.argv.includes("--json");

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.error(`SKIP — could not mint a session: ${session.reason ?? "unknown"}`);
  process.exit(2);
}

async function truth(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function ask(question) {
  // Refresh the short-lived JWT before every ask (see THE SESSION LESSON above).
  const fresh = await session.refresh?.();
  const cookie = fresh?.cookieHeader ?? session.cookieHeader;
  const res = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ question, depth: "concrete" }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const j = await res.json();
  return { answer: j.answer ?? "", tools: j.tools_used ?? [] };
}

/** Derive the current 0DTE session phase the SAME way the product does, for the session check. */
function currentPhase() {
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const hour = Number(et.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(et.find((p) => p.type === "minute")?.value ?? "0");
  const wd = et.find((p) => p.type === "weekday")?.value ?? "";
  const m = hour * 60 + minute;
  if (["Sat", "Sun"].includes(wd)) return "CLOSED";
  if (m < 9 * 60 + 30) return "PRE_MARKET";
  if (m < 10 * 60) return "OPENING_DRIVE";
  if (m < 15 * 60 + 30) return "RTH";
  if (m < 15 * 60 + 50) return "POST_COMMIT";
  if (m < 16 * 60) return "LATE_SESSION";
  return "CLOSED";
}

let exitCode = 1;
try {
  const banger = await truth("/api/market/banger/board");
  const closedRows = (banger?.closed ?? [])
    .map((p) => ({ ticker: p.ticker, realized_pnl_pct: p.realized_pnl_pct }))
    .filter((r) => r.realized_pnl_pct != null);
  const phase = currentPhase();

  // Each check: a live question + its graders (given the ground truth already fetched).
  const CHECKS = [
    {
      id: "condor-exists",
      q: "What is the win rate on the Night Hawk iron condor, and is there a catch I should know about?",
      graders: (a) => [
        ["condor acknowledged", condorDeniedExists(a)],
        ["win rate paired with breach", condorWinRateHasBreachCompanion(a)],
      ],
    },
    {
      id: "rejections-session",
      q: "What 0DTE Command plays did the scanner reject today, and which gate failed for each?",
      graders: (a) => [["session state honest", sessionClaimMatchesPhase(a, phase)]],
    },
    {
      id: "banger-pnl-signs",
      q: "How have the Night Hawk banger plays done recently? Give me the realized P&L on the last few closed ones.",
      graders: (a) => [["no P&L sign flips vs realized", pnlSignFlips(a, closedRows)]],
    },
    {
      id: "gate-value-denominator",
      q: "For the Night Hawk publish gate, which gate blocked the most winners, and what is its win rate on the plays it blocked?",
      graders: (a) => [["stated rates self-consistent", statedRatesAreSelfConsistent(a)]],
    },
  ];

  const rows = [];
  for (const c of CHECKS) {
    const r = await ask(c.q);
    if (r.error) {
      rows.push({ id: c.id, verdicts: [["asked", { pass: false, detail: r.error }]] });
      continue;
    }
    rows.push({ id: c.id, tools: r.tools, verdicts: c.graders(r.answer), answer: r.answer.slice(0, 240) });
  }

  const failures = rows.flatMap((row) =>
    row.verdicts.filter(([, v]) => !v.pass).map(([name, v]) => `${row.id} · ${name}: ${v.detail}`),
  );

  if (JSON_OUT) {
    console.log(JSON.stringify({ phase, closedRows, rows, failures }, null, 2));
  } else {
    console.log(`Night Hawk × Largo stress — phase ${phase}, ${closedRows.length} closed banger rows for P&L check\n`);
    for (const row of rows) {
      for (const [name, v] of row.verdicts) {
        console.log(`  ${v.pass ? "✅" : "❌"} ${row.id.padEnd(24)} ${name} — ${v.detail}`);
      }
    }
    console.log(`\n=== ${failures.length ? `${failures.length} FAIL` : "ALL PASS"} ===`);
    for (const f of failures) console.log(`    ${f}`);
  }
  exitCode = failures.length ? 1 : 0;
} finally {
  await session.cleanup?.();
}
process.exit(exitCode);
