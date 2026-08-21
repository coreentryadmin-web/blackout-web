/**
 * LARGO AVAILABILITY PROBE — does Largo ANSWER a question whose data is demonstrably present?
 *
 * WHY THIS EXISTS. Every prior Largo audit graded whether an answer was CORRECT or ROUTED
 * correctly, and every one of them ran during RTH. None asked the question that matters for most
 * of the clock: when the cash session is CLOSED but the cached GEX matrix is still warm, does
 * Largo answer a dealer-positioning question, or does it decline?
 *
 * Measured 2026-08-21 ~13:17 ET (17 min after the close): `GET /api/market/gex-positioning?ticker=SPY`
 * returned `available:true, spot 766.27, gamma_posture "short", net_vex +$332B, vanna_posture
 * "positive"` — full, fresh data. Yet `POST /api/market/largo/query` answered "What is SPY's dealer
 * gamma posture right now?" with **"I couldn't pull enough live data to answer that — try naming a
 * ticker or asking about SPX structure"** on 3/3 retries, using only the `live_feed_capture` /
 * `platform_vitals_prefetch` prefetch steps and NEVER calling `get_positioning`. It is not
 * thermal-specific: a Night Hawk question returned "internal error … desk tools did not complete
 * cleanly", and "What is SPX structure?" — the decline message's OWN suggestion — also declined.
 *
 * So this probe pairs each Largo question with an INDEPENDENT availability check of the tool that
 * would answer it, and flags any case where the DATA IS PRESENT but Largo DECLINES. That is the
 * defect class no correctness test can see, because a correctness test never runs when the answer
 * is a decline.
 *
 * The instrument is a model, so a decline is only a DEFECT when we can prove the data was there:
 * every graded question carries a `truthEndpoint` whose `available:true` + non-null key field is
 * the proof. A question we cannot independently verify is reported INDETERMINATE, never a pass.
 *
 * READ-ONLY. One temp premium Clerk session, refreshed before every request (the __session JWT is
 * ~60-72s and each answer takes several seconds), cleaned up at the end. Exits non-zero if any
 * question DECLINED while its data was provably available.
 *
 * Run: NODE_USE_ENV_PROXY is not needed (pure HTTP). Node 20:
 *   export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
 *   node scripts/audit/largo-availability-probe.mjs [--base=https://blackouttrades.com] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { gradeAvailability } from "./lib/availability-verdict.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const BASE = (typeof args.base === "string" && args.base) || "https://blackouttrades.com";
const JSON_OUT = !!args.json;

const et = () =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).format(new Date());

/**
 * Each case: a member question + the endpoint whose `available:true` + a non-null `proofField`
 * proves the data existed, so a decline is a genuine defect and not honest absence.
 */
const CASES = [
  {
    id: "spy-gamma-posture",
    question: "What is SPY's dealer gamma posture and net GEX right now?",
    truthEndpoint: "/api/market/gex-positioning?ticker=SPY",
    proofField: "gamma_posture",
  },
  {
    id: "spy-vanna",
    question: "What is SPY's net vanna and vanna posture?",
    truthEndpoint: "/api/market/gex-positioning?ticker=SPY",
    proofField: "vanna_posture",
  },
  {
    id: "qqq-walls",
    question: "Where are the call wall and put wall on QQQ?",
    truthEndpoint: "/api/market/gex-positioning?ticker=QQQ",
    proofField: "call_wall",
  },
];

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error("MINT SKIP", session.reason);
    process.exit(1);
  }
  async function freshCookie() {
    const r = await session.refresh?.();
    return (r && r.cookieHeader) || session.cookieHeader;
  }
  async function ask(question) {
    const r = await fetch(`${BASE}/api/market/largo/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await freshCookie() },
      body: JSON.stringify({ question, session_id: `avail-${Date.now()}` }),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return r.json();
  }
  async function truth(endpoint) {
    const r = await fetch(`${BASE}${endpoint}`, { headers: { Cookie: await freshCookie() } });
    if (!r.ok) return { available: false, _status: r.status };
    const j = await r.json();
    return j?.positioning ?? j ?? {};
  }

  const results = [];
  try {
    for (const c of CASES) {
      const pos = await truth(c.truthEndpoint);
      const dataPresent = pos?.available !== false && pos?.[c.proofField] != null;
      const a = await ask(c.question);
      const answer = String(a?.answer ?? a?.error ?? "");
      const tools = a?.tools_used ?? [];
      results.push(
        gradeAvailability({
          id: c.id,
          question: c.question,
          dataPresent,
          proofValue: pos?.[c.proofField] ?? null,
          answer,
          tools,
        })
      );
    }
  } finally {
    await session.cleanup?.().catch(() => {});
  }

  const declinedWithData = results.filter((r) => r.verdict === "DECLINED_WITH_DATA");
  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, et: et(), results }, null, 2));
  } else {
    console.log(`Largo availability probe — ${et()} ET · ${BASE}`);
    for (const r of results) {
      console.log(`\n[${r.id}] ${r.verdict}`);
      console.log(`  data present: ${r.dataPresent} (${r.proofValue}) · Largo: ${r.declined ? "DECLINED" : "answered"}`);
      console.log(`  tools: ${r.tools.join(", ") || "(none)"}`);
      console.log(`  answer: ${r.answer.slice(0, 160).replace(/\n/g, " ")}`);
    }
    console.log(
      `\n${declinedWithData.length === 0 ? "OK" : "DEFECT"} — ${declinedWithData.length}/${results.length} declined while their data was provably available`
    );
  }
  process.exit(declinedWithData.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR", e?.message ?? e);
  process.exit(1);
});
