import { mintClerkPremiumSession } from "./scripts/audit/lib/prod-clerk-session.mjs";
const BASE = "https://blackouttrades.com";
const s = await mintClerkPremiumSession({ appUrl: BASE });
if (s.skip) { console.log("SKIP", s.reason); process.exit(1); }
const seen = (o, d=0) => JSON.stringify(o).slice(0, 1200);
try {
  const { cookieHeader } = await s.refresh();
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Cookie: cookieHeader, Accept: "application/json" } });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const b = (await get("/api/market/zerodte/board")).json ?? {};
  console.log("=== 0DTE BOARD top-level keys:", Object.keys(b).join(","));
  for (const k of ["funnel","gates","rejections","governor","diagnostics","scan","stats","meta"]) {
    if (b[k]) console.log(`--- ${k}: ${seen(b[k])}`);
  }
  const setups = b.setups ?? [];
  if (setups[0]) console.log("--- setup[0] keys:", Object.keys(setups[0]).join(","));
  // score distribution
  const scores = setups.map(x => x.score ?? x.composite_score ?? x.total_score).filter(Number.isFinite);
  if (scores.length) {
    scores.sort((a,b)=>b-a);
    console.log(`--- setup scores n=${scores.length} max=${scores[0]} p50=${scores[Math.floor(scores.length/2)]} min=${scores[scores.length-1]}`);
  }
  console.log("=== FUNNEL:", JSON.stringify(b.discovery_funnel));
  // Gate + cortex reason distribution across all setups
  const gateReason = {}, cortexDec = {}, halted = {}, conf = {};
  for (const x of setups) {
    const g = x.gate ?? {};
    const key = g.blocked ? `BLOCKED:${g.reason ?? g.code ?? "?"}` : (g.passed === false ? `FAIL:${g.reason ?? "?"}` : "pass");
    gateReason[key] = (gateReason[key] ?? 0) + 1;
    cortexDec[String(x.cortex?.decision ?? x.cortex?.verdict ?? "-")] = (cortexDec[String(x.cortex?.decision ?? x.cortex?.verdict ?? "-")] ?? 0) + 1;
    halted[String(x.halted)] = (halted[String(x.halted)] ?? 0) + 1;
    conf[String(x.confluence?.tier ?? x.confluence?.count ?? x.confluence ?? "-")] = (conf[String(x.confluence?.tier ?? x.confluence?.count ?? x.confluence ?? "-")] ?? 0) + 1;
  }
  console.log("=== gate:", JSON.stringify(gateReason));
  console.log("=== cortex:", JSON.stringify(cortexDec));
  console.log("=== halted:", JSON.stringify(halted));
  console.log("=== confluence:", JSON.stringify(conf).slice(0,400));
  console.log("=== sample gate blob:", JSON.stringify(setups[0]?.gate));
  console.log("=== top5 by score:", setups.slice().sort((a,b)=>(b.score??0)-(a.score??0)).slice(0,5).map(x=>`${x.ticker}/${x.direction}/${x.score}/gate=${x.gate?.blocked?(x.gate.reason??x.gate.code):"ok"}/cortex=${x.cortex?.decision??"-"}`).join("  "));
} finally { await s.cleanup?.(); console.log("temp user deleted"); }
