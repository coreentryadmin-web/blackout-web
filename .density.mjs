import { fetchAuditJson, releaseAuditClerkSession } from "./scripts/audit/lib/audit-auth-fetch.mjs";
const B = "https://blackouttrades.com";
const et = () => new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:false});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const rows = [];
try {
  for (let i=0;i<7;i++){
    const [q,ctx,board] = await Promise.all([
      fetchAuditJson(B,"/api/market/quote?ticker=SPX"),
      fetchAuditJson(B,"/api/market/largo/context?ticker=SPX"),
      fetchAuditJson(B,"/api/market/zerodte/board"),
    ]);
    const c = ctx.json ?? {}, bd = board.json?.data ?? board.json ?? {};
    const setups = bd.setups?.length ?? bd.live?.length ?? bd.plays?.length ?? null;
    const open = (bd.plays ?? bd.committed ?? []).filter?.(p=>/open|hold|trim/i.test(String(p.status??"")))?.length ?? null;
    const r = { t: et(), spot:q.json?.price, cspot:c.spot, call:c.call_wall, put:c.put_wall,
                flip:c.gamma_flip, regime:c.regime, net:c.net_premium, prints:c.print_count,
                conc:c.flow_concentrated, setups, open };
    rows.push(r);
    console.log(`${r.t}  spot=${String(r.spot).padEnd(8)} rail=${String(r.cspot).padEnd(8)} call=${r.call} put=${r.put} flip=${r.flip} regime=${String(r.regime).padEnd(11)} net=${r.net==null?"—":"$"+(r.net/1e6).toFixed(1)+"M"} prints=${r.prints} setups=${r.setups}`);
    if (i<6) await sleep(85_000);
  }
  // freshness verdict
  const uniq = k => new Set(rows.map(r=>String(r[k]))).size;
  console.log(`\nFRESHNESS over ${rows.length} captures (~9min):`);
  for (const k of ["spot","cspot","call","put","flip","regime","net","prints","setups"]) {
    const n = uniq(k);
    console.log(`  ${k.padEnd(8)} distinct=${n} ${n===1?"<- UNCHANGED":""}`);
  }
} finally { await releaseAuditClerkSession().catch(()=>{}); }
