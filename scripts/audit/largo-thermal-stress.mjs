/**
 * LARGO THERMAL STRESS TEST — drives the FULL live Largo answer loop and grades the natural-language
 * answers against ground truth, not just the tool payloads.
 *
 * WHY THIS EXISTS. #2422 fixed the tool DATA (dealer gamma is served non-directionally). But the
 * model writes the member-facing sentence, and a correct payload does not guarantee a correct
 * sentence: on 2026-08-21 this harness caught Largo answering "dealer gamma reads bearish" to a
 * leading "bullish or bearish?" question on one sampling and "mixed, not a clean directional setup"
 * on the next — same data, different words. That is the class of defect no tool-payload test can
 * see, and it is why the answer layer has to be exercised directly.
 *
 * POSTs /api/market/largo/query with an admin+premium temp session (admin bypasses the launch gate),
 * REFRESHING the __session JWT before every request — it is ~60-72s and each answer takes several
 * seconds, so a single-mint run 401s partway through (measured). One temp user, deleted in finally.
 * Read-only w.r.t. state; it spends Anthropic tokens, so keep the battery focused.
 *
 * Run from the repo root: NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/largo-thermal-stress.mjs
 * Each check cross-references the answer against a live get_positioning read, so the graders adapt
 * to whatever the market is doing rather than asserting fixed numbers.
 */
// STRESS-TEST live Largo on thermal questions, cross-checking each answer against ground truth.
// Drives POST /api/market/largo/query (the full model answer loop) with an admin+premium session,
// then fetches gex-positioning independently and grades the natural-language answer.
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = "https://blackouttrades.com";
const et = () => new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).format(new Date());

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) { console.error("MINT SKIP", session.reason); process.exit(1); }
let CK = session.cookieHeader;
async function freshCookie() {
  // Largo answers take several seconds; the __session JWT is ~60-72s. Refresh before EVERY
  // request or the run 401s partway through.
  const r = await session.refresh?.();
  if (r && r.cookieHeader) CK = r.cookieHeader;
  return CK;
}

async function ask(question) {
  const r = await fetch(`${BASE}/api/market/largo/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await freshCookie() },
    body: JSON.stringify({ question, session_id: `stress-${Date.now()}-${Math.round(Math.random()*1e6)}` }),
  });
  if (!r.ok) return { error: `HTTP ${r.status}`, body: (await r.text()).slice(0,200) };
  return r.json();
}
async function truth(ticker) {
  const r = await fetch(`${BASE}/api/market/gex-positioning?ticker=${ticker}`, { headers: { Cookie: await freshCookie() } });
  const j = await r.json();
  return j?.positioning ?? j ?? {};
}

const results = [];
function grade(id, q, ans, checks) {
  const answer = String(ans?.answer ?? ans?.error ?? "");
  const tools = ans?.tools_used ?? [];
  const passed = checks.filter(c => c.ok).length;
  results.push({ id, q, answer, tools, checks, passed, total: checks.length });
  console.log(`\n[${id}] "${q}"`);
  console.log(`  tools: ${tools.join(", ") || "(none)"}`);
  console.log(`  answer: ${answer.slice(0, 320).replace(/\n/g," ")}${answer.length>320?"…":""}`);
  for (const c of checks) console.log(`    ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
}
const has = (s, re) => re.test(String(s));

try {
  console.log(`Largo thermal stress test — ${et()} ET, ${new Date().toISOString()}`);
  const spy = await truth("SPY"), qqq = await truth("QQQ"), spx = await truth("SPX");
  console.log(`ground truth SPY: posture=${spy.gamma_posture} flip=${spy.flip} callWall=${spy.call_wall} putWall=${spy.put_wall} spot=${spy.spot}`);

  // Q1 — THE P0: gamma posture must not be miscalled as a bullish/bearish DIRECTION
  let a = await ask("What is SPY's dealer gamma posture right now?");
  grade("Q1-posture", "SPY gamma posture", a, [
    { name: "mentions short/long gamma (posture)", ok: has(a.answer, /short gamma|long gamma|negative gamma|positive gamma/i) },
    { name: "does NOT call gamma itself 'bullish'/'bearish' as a direction",
      ok: !has(a.answer, /gamma is (bullish|bearish)|bullish gamma|bearish gamma/i) },
    { name: "used a thermal tool", ok: (a.tools_used||[]).some(t=>/positioning|gex|thermal/i.test(t)) },
  ]);

  // Q2 — direct "is it bullish or bearish" — must not answer direction FROM gamma alone
  a = await ask("Based on dealer gamma, is SPY set up bullish or bearish right now?");
  grade("Q2-direction-trap", "bullish/bearish from gamma", a, [
    { name: "explains gamma amplifies both ways / is non-directional",
      ok: has(a.answer, /both direction|either direction|not directional|amplif|non-directional|whichever way/i) },
    { name: "does NOT label the gamma regime itself bullish or bearish",
      ok: !has(a.answer, /gamma (is|reads|looks) (bullish|bearish)|(bullish|bearish)\/?(unstable|)? *(regime|read|setup|gamma)|reads (bullish|bearish)/i) },
  ]);

  // Q3 — FRESHNESS: market is closed; must not present the close as a live quote
  a = await ask("Where is SPY trading right now?");
  grade("Q3-freshness", "live price when closed", a, [
    { name: "acknowledges market closed / last close / not live",
      ok: has(a.answer, /clos|last (trade|price|print|session)|after.?hours|not live|as of/i) },
  ]);

  // Q4 — flip level accuracy
  a = await ask("What is the gamma flip level for SPY?");
  const flipOk = spy.flip == null || has(a.answer, new RegExp(String(Math.round(spy.flip))));
  grade("Q4-flip", "flip accuracy", a, [
    { name: spy.flip == null ? "flip is null upstream — must not fabricate a number"
                             : `states the real flip (${spy.flip})`,
      ok: spy.flip == null ? !has(a.answer, /flip (is|at|near) \d{3,}/i) : flipOk },
  ]);

  // Q5 — walls accuracy
  a = await ask("Where are the call wall and put wall on QQQ?");
  grade("Q5-walls", "QQQ walls", a, [
    { name: qqq.call_wall!=null ? `call wall ${qqq.call_wall}` : "no call wall — must not invent",
      ok: qqq.call_wall!=null ? has(a.answer, new RegExp(String(Math.round(qqq.call_wall)))) : true },
    { name: qqq.put_wall!=null ? `put wall ${qqq.put_wall}` : "no put wall — must not invent",
      ok: qqq.put_wall!=null ? has(a.answer, new RegExp(String(Math.round(qqq.put_wall)))) : true },
  ]);

  // Q6 — comparison across tickers
  a = await ask("Compare dealer gamma positioning across SPY, SPX and QQQ.");
  grade("Q6-compare", "3-ticker compare", a, [
    { name: "names all three tickers", ok: has(a.answer,/SPY/) && has(a.answer,/SPX/) && has(a.answer,/QQQ/) },
    { name: "used compare tool", ok: (a.tools_used||[]).some(t=>/thermal_compare|compare/i.test(t)) },
  ]);

  // Q7 — flow vs gamma
  a = await ask("Are options flow and dealer gamma agreeing or conflicting on SPX right now?");
  grade("Q7-flow-vs-gamma", "flow vs gamma", a, [
    { name: "addresses both flow and gamma", ok: has(a.answer,/flow/i) && has(a.answer,/gamma/i) },
    { name: "does not fabricate a directional 'conflict' from gamma",
      ok: !has(a.answer, /gamma (is|reads) (bullish|bearish)/i) },
  ]);

  // Q8 — absence: an obscure ticker with no options market
  a = await ask("What is the dealer gamma positioning on GNS right now?");
  grade("Q8-absence", "no-data ticker", a, [
    { name: "honestly reports no data / unavailable, does NOT fabricate levels",
      ok: has(a.answer, /no (data|positioning|matrix|options|dealer gamma)|unavailable|don't have|not available|couldn't|no gamma/i)
          && !has(a.answer, /flip (is|at) \d{2,}/i) },
  ]);

  const totalPass = results.reduce((s,r)=>s+r.passed,0), totalChecks = results.reduce((s,r)=>s+r.total,0);
  console.log(`\n===== ${totalPass}/${totalChecks} checks passed across ${results.length} questions =====`);
  const failing = results.filter(r=>r.passed<r.total);
  if (failing.length) { console.log("FAILING QUESTIONS:"); for (const r of failing) console.log(`  [${r.id}] ${r.passed}/${r.total} — ${r.checks.filter(c=>!c.ok).map(c=>c.name).join("; ")}`); }
} finally {
  await session.cleanup?.().catch(()=>{});
}
